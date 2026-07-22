<?php
declare(strict_types=1);

/**
 * NV5 SIS – server entry for /sis/
 * Uploads this branch to nv5.haatetepe.no/sis/
 *
 * Serves cached main from ./content/
 * Sync:  /sis/?sync=1&token=YOUR_TOKEN
 * Force: /sis/?sync=1&force=1&token=YOUR_TOKEN
 */

$config = [
    'github_owner' => 'blepman',
    'github_repo' => 'nv5-sis',
    'github_branch' => 'main',
    'github_token' => '',
    'sync_token' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
    'sync_on_view_interval' => 300,
    'user_agent' => 'nv5-sis-server',
];

if (is_file(__DIR__ . '/config.php')) {
    $override = require __DIR__ . '/config.php';
    if (is_array($override)) {
        $config = array_merge($config, $override);
    }
}

$root = __DIR__;
$paths = [
    'content' => $root . '/content',
    'tmp' => $root . '/content.tmp',
    'old' => $root . '/content.old',
    'sha' => $root . '/.last-sha',
    'lock' => $root . '/.sync.lock',
];

try {
    if (isset($_GET['sync'])) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        require_token($config);
        $force = isset($_GET['force']) && $_GET['force'] === '1';
        echo json_encode(sync($config, $paths, $force), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    maybe_sync_on_view($config, $paths);
    render_board($config, $paths);
} catch (Throwable $e) {
    $wantsJson = isset($_GET['sync']);
    if ($wantsJson) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        exit;
    }
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="nb"><meta charset="utf-8"><title>SIS</title>';
    echo '<h1>Kunne ikke starte tavlen</h1><p>' . h($e->getMessage()) . '</p>';
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function require_token(array $config): void
{
    $token = $_GET['token'] ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (is_string($token) && strncmp($token, 'Bearer ', 7) === 0) {
        $token = substr($token, 7);
    }
    $expected = (string) ($config['sync_token'] ?? '');
    if ($expected === '' || $expected === 'CHANGE_ME_TO_A_LONG_RANDOM_STRING' || !hash_equals($expected, (string) $token)) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'Ugyldig token'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

function http_get(string $url, array $config): string
{
    $headers = [
        'Accept: application/vnd.github+json',
        'User-Agent: ' . ($config['user_agent'] ?? 'nv5-sis-server'),
        'X-GitHub-Api-Version: 2022-11-28',
    ];
    if (!empty($config['github_token'])) {
        $headers[] = 'Authorization: Bearer ' . $config['github_token'];
    }

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('cURL-feil: ' . $error);
        }
        if ($status >= 400) {
            throw new RuntimeException('HTTP ' . $status . ' fra GitHub');
        }
        return $body;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers),
            'timeout' => 60,
            'ignore_errors' => true,
        ],
    ]);
    $body = file_get_contents($url, false, $ctx);
    if ($body === false) {
        throw new RuntimeException('Kunne ikke hente ' . $url);
    }
    return $body;
}

function remote_sha(array $config): string
{
    $owner = rawurlencode($config['github_owner']);
    $repo = rawurlencode($config['github_repo']);
    $branch = rawurlencode($config['github_branch']);
    $data = json_decode(http_get("https://api.github.com/repos/{$owner}/{$repo}/commits/{$branch}", $config), true);
    if (!is_array($data) || empty($data['sha'])) {
        throw new RuntimeException('Ugyldig svar fra GitHub commits API');
    }
    return $data['sha'];
}

function local_sha(array $paths): string
{
    return is_file($paths['sha']) ? trim((string) file_get_contents($paths['sha'])) : '';
}

function rm_tree(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path) && !is_link($path)) {
            rm_tree($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function copy_tree(string $src, string $dst): void
{
    if (!is_dir($dst) && !mkdir($dst, 0755, true) && !is_dir($dst)) {
        throw new RuntimeException('Kunne ikke lage mappe: ' . $dst);
    }
    foreach (scandir($src) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $from = $src . DIRECTORY_SEPARATOR . $item;
        $to = $dst . DIRECTORY_SEPARATOR . $item;
        if (is_dir($from) && !is_link($from)) {
            copy_tree($from, $to);
        } elseif (!copy($from, $to)) {
            throw new RuntimeException('Kunne ikke kopiere ' . $from);
        }
    }
}

function extract_zipball(string $zipData, string $targetDir): void
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('PHP ZipArchive mangler (ext-zip)');
    }

    $tmpZip = sys_get_temp_dir() . '/nv5-sis-' . bin2hex(random_bytes(8)) . '.zip';
    if (file_put_contents($tmpZip, $zipData) === false) {
        throw new RuntimeException('Kunne ikke skrive zip');
    }

    $tmpExtract = sys_get_temp_dir() . '/nv5-sis-x-' . bin2hex(random_bytes(8));
    try {
        $zip = new ZipArchive();
        if ($zip->open($tmpZip) !== true) {
            throw new RuntimeException('Kunne ikke åpne zipball');
        }
        if (!mkdir($tmpExtract, 0755, true) && !is_dir($tmpExtract)) {
            $zip->close();
            throw new RuntimeException('Kunne ikke lage extract-mappe');
        }
        if (!$zip->extractTo($tmpExtract)) {
            $zip->close();
            throw new RuntimeException('Klarte ikke å pakke ut zipball');
        }
        $zip->close();

        $entries = array_values(array_filter(scandir($tmpExtract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1 || !is_dir($tmpExtract . '/' . $entries[0])) {
            throw new RuntimeException('Uventet zipball-struktur');
        }

        rm_tree($targetDir);
        copy_tree($tmpExtract . '/' . $entries[0], $targetDir);
    } finally {
        @unlink($tmpZip);
        rm_tree($tmpExtract);
    }
}

function sync(array $config, array $paths, bool $force = false): array
{
    $fh = fopen($paths['lock'], 'c+');
    if ($fh === false) {
        throw new RuntimeException('Kunne ikke åpne sync-lock');
    }
    if (!flock($fh, LOCK_EX | LOCK_NB)) {
        fclose($fh);
        return ['ok' => true, 'updated' => false, 'sha' => local_sha($paths), 'message' => 'Sync pågår allerede'];
    }

    try {
        $remote = remote_sha($config);
        $local = local_sha($paths);
        if (!$force && $remote === $local && is_file($paths['content'] . '/index.html')) {
            return ['ok' => true, 'updated' => false, 'sha' => $local, 'message' => 'Allerede på siste main (' . substr($local, 0, 7) . ')'];
        }

        $owner = rawurlencode($config['github_owner']);
        $repo = rawurlencode($config['github_repo']);
        $branch = rawurlencode($config['github_branch']);
        $zip = http_get("https://api.github.com/repos/{$owner}/{$repo}/zipball/{$branch}", $config);

        rm_tree($paths['tmp']);
        extract_zipball($zip, $paths['tmp']);
        if (!is_file($paths['tmp'] . '/index.html')) {
            rm_tree($paths['tmp']);
            throw new RuntimeException('Zipball mangler index.html');
        }

        rm_tree($paths['old']);
        if (is_dir($paths['content']) && !rename($paths['content'], $paths['old'])) {
            throw new RuntimeException('Klarte ikke å flytte gammel content');
        }
        if (!rename($paths['tmp'], $paths['content'])) {
            if (is_dir($paths['old'])) {
                rename($paths['old'], $paths['content']);
            }
            throw new RuntimeException('Klarte ikke å aktivere ny content');
        }
        rm_tree($paths['old']);
        file_put_contents($paths['sha'], $remote . PHP_EOL);

        return ['ok' => true, 'updated' => true, 'sha' => $remote, 'message' => 'Oppdatert til ' . substr($remote, 0, 7)];
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function maybe_sync_on_view(array $config, array $paths): void
{
    $interval = (int) ($config['sync_on_view_interval'] ?? 300);
    if ($interval <= 0) {
        return;
    }
    $mtime = is_file($paths['sha']) ? (int) filemtime($paths['sha']) : 0;
    if ($mtime > 0 && (time() - $mtime) < $interval && is_file($paths['content'] . '/index.html')) {
        return;
    }
    try {
        sync($config, $paths, false);
    } catch (Throwable $e) {
        error_log('nv5-sis sync-on-view: ' . $e->getMessage());
    }
}

function content_base_href(): string
{
    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/sis/index.php'));
    if ($dir === '/' || $dir === '.') {
        return '/content/';
    }
    return rtrim($dir, '/') . '/content/';
}

function render_board(array $config, array $paths): void
{
    $index = $paths['content'] . '/index.html';
    if (!is_file($index)) {
        sync($config, $paths, true);
    }

    $html = file_get_contents($paths['content'] . '/index.html');
    if ($html === false) {
        throw new RuntimeException('Kunne ikke lese content/index.html');
    }

    $base = '<base href="' . h(content_base_href()) . '">';
    if (stripos($html, '<base ') === false) {
        if (preg_match('/<head[^>]*>/i', $html)) {
            $html = preg_replace('/<head[^>]*>/i', '$0' . "\n    " . $base, $html, 1);
        } else {
            $html = $base . $html;
        }
    }

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo $html;
}
