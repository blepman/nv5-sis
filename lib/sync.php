<?php

function nv5_load_config(): array
{
    $configPath = dirname(__DIR__) . '/config.php';
    if (!is_file($configPath)) {
        throw new RuntimeException(
            'Mangler config.php. Kopier config.example.php til config.php og fyll inn verdier.'
        );
    }

    $config = require $configPath;
    if (!is_array($config)) {
        throw new RuntimeException('config.php må returnere et array.');
    }

    return $config;
}

function nv5_paths(): array
{
    $root = dirname(__DIR__);
    return [
        'root' => $root,
        'content' => $root . '/content',
        'content_tmp' => $root . '/content.tmp',
        'content_old' => $root . '/content.old',
        'sha_file' => $root . '/.last-sha',
        'lock_file' => $root . '/.sync.lock',
    ];
}

function nv5_http_get(string $url, array $config, array $extraHeaders = []): string
{
    $headers = array_merge(
        [
            'Accept: application/vnd.github+json',
            'User-Agent: ' . ($config['user_agent'] ?? 'nv5-sis-server'),
            'X-GitHub-Api-Version: 2022-11-28',
        ],
        $extraHeaders
    );

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
            throw new RuntimeException('HTTP ' . $status . ' fra ' . $url);
        }
        return $body;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers),
            'timeout' => 60,
            'ignore_errors' => true,
        ],
    ]);
    $body = file_get_contents($url, false, $context);
    if ($body === false) {
        throw new RuntimeException('Kunne ikke hente ' . $url);
    }
    return $body;
}

function nv5_remote_sha(array $config): string
{
    $owner = rawurlencode($config['github_owner']);
    $repo = rawurlencode($config['github_repo']);
    $branch = rawurlencode($config['github_branch']);
    $url = "https://api.github.com/repos/{$owner}/{$repo}/commits/{$branch}";
    $json = nv5_http_get($url, $config);
    $data = json_decode($json, true);
    if (!is_array($data) || empty($data['sha'])) {
        throw new RuntimeException('Ugyldig svar fra GitHub commits API.');
    }
    return $data['sha'];
}

function nv5_local_sha(array $paths): string
{
    if (!is_file($paths['sha_file'])) {
        return '';
    }
    return trim((string) file_get_contents($paths['sha_file']));
}

function nv5_rm_tree(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }

    $items = scandir($dir);
    if ($items === false) {
        return;
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path) && !is_link($path)) {
            nv5_rm_tree($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function nv5_extract_zipball(string $zipData, string $targetDir): void
{
    $tmpZip = sys_get_temp_dir() . '/nv5-sis-' . bin2hex(random_bytes(8)) . '.zip';
    if (file_put_contents($tmpZip, $zipData) === false) {
        throw new RuntimeException('Kunne ikke skrive midlertidig zip.');
    }

    try {
        if (!class_exists('ZipArchive')) {
            throw new RuntimeException('PHP ZipArchive mangler. Aktiver ext-zip på hosten.');
        }

        $zip = new ZipArchive();
        if ($zip->open($tmpZip) !== true) {
            throw new RuntimeException('Kunne ikke åpne zipball.');
        }

        $tmpExtract = sys_get_temp_dir() . '/nv5-sis-extract-' . bin2hex(random_bytes(8));
        if (!mkdir($tmpExtract, 0755, true) && !is_dir($tmpExtract)) {
            $zip->close();
            throw new RuntimeException('Kunne ikke lage extract-mappe.');
        }

        if (!$zip->extractTo($tmpExtract)) {
            $zip->close();
            nv5_rm_tree($tmpExtract);
            throw new RuntimeException('Klarte ikke å pakke ut zipball.');
        }
        $zip->close();

        $entries = array_values(array_filter(scandir($tmpExtract) ?: [], function ($name) {
            return $name !== '.' && $name !== '..';
        }));

        if (count($entries) !== 1 || !is_dir($tmpExtract . '/' . $entries[0])) {
            nv5_rm_tree($tmpExtract);
            throw new RuntimeException('Uventet zipball-struktur fra GitHub.');
        }

        $sourceRoot = $tmpExtract . '/' . $entries[0];
        nv5_rm_tree($targetDir);
        if (!mkdir($targetDir, 0755, true) && !is_dir($targetDir)) {
            nv5_rm_tree($tmpExtract);
            throw new RuntimeException('Kunne ikke lage content-tmp.');
        }

        nv5_copy_tree($sourceRoot, $targetDir);
        nv5_rm_tree($tmpExtract);
    } finally {
        @unlink($tmpZip);
    }
}

function nv5_copy_tree(string $src, string $dst): void
{
    if (!is_dir($dst) && !mkdir($dst, 0755, true) && !is_dir($dst)) {
        throw new RuntimeException('Kunne ikke lage mappe: ' . $dst);
    }

    $items = scandir($src);
    if ($items === false) {
        throw new RuntimeException('Kunne ikke lese mappe: ' . $src);
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $from = $src . DIRECTORY_SEPARATOR . $item;
        $to = $dst . DIRECTORY_SEPARATOR . $item;
        if (is_dir($from) && !is_link($from)) {
            nv5_copy_tree($from, $to);
        } else {
            if (!copy($from, $to)) {
                throw new RuntimeException('Kunne ikke kopiere ' . $from);
            }
        }
    }
}

/**
 * @return resource|null
 */
function nv5_acquire_lock(array $paths)
{
    $fh = fopen($paths['lock_file'], 'c+');
    if ($fh === false) {
        throw new RuntimeException('Kunne ikke åpne sync-lock.');
    }
    if (!flock($fh, LOCK_EX | LOCK_NB)) {
        fclose($fh);
        return null;
    }
    return $fh;
}

/**
 * Sync main branch into ./content.
 *
 * @return array{updated: bool, sha: string, message: string}
 */
function nv5_sync(array $config, bool $force = false): array
{
    $paths = nv5_paths();
    $lock = nv5_acquire_lock($paths);
    if ($lock === null) {
        return [
            'updated' => false,
            'sha' => nv5_local_sha($paths),
            'message' => 'Sync pågår allerede.',
        ];
    }

    try {
        $remoteSha = nv5_remote_sha($config);
        $localSha = nv5_local_sha($paths);

        if (!$force && $remoteSha !== '' && $remoteSha === $localSha && is_file($paths['content'] . '/index.html')) {
            return [
                'updated' => false,
                'sha' => $localSha,
                'message' => 'Allerede på siste main (' . substr($localSha, 0, 7) . ').',
            ];
        }

        $owner = rawurlencode($config['github_owner']);
        $repo = rawurlencode($config['github_repo']);
        $branch = rawurlencode($config['github_branch']);
        $zipUrl = "https://api.github.com/repos/{$owner}/{$repo}/zipball/{$branch}";
        $zipData = nv5_http_get($zipUrl, $config, ['Accept: application/vnd.github+json']);

        nv5_rm_tree($paths['content_tmp']);
        nv5_extract_zipball($zipData, $paths['content_tmp']);

        if (!is_file($paths['content_tmp'] . '/index.html')) {
            nv5_rm_tree($paths['content_tmp']);
            throw new RuntimeException('Zipball mangler index.html – er main klar?');
        }

        nv5_rm_tree($paths['content_old']);
        if (is_dir($paths['content'])) {
            if (!rename($paths['content'], $paths['content_old'])) {
                throw new RuntimeException('Klarte ikke å flytte gammel content.');
            }
        }
        if (!rename($paths['content_tmp'], $paths['content'])) {
            // rollback
            if (is_dir($paths['content_old'])) {
                rename($paths['content_old'], $paths['content']);
            }
            throw new RuntimeException('Klarte ikke å aktivere ny content.');
        }
        nv5_rm_tree($paths['content_old']);

        file_put_contents($paths['sha_file'], $remoteSha . PHP_EOL);

        return [
            'updated' => true,
            'sha' => $remoteSha,
            'message' => 'Oppdatert til ' . substr($remoteSha, 0, 7) . '.',
        ];
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function nv5_maybe_sync_on_view(array $config): void
{
    $paths = nv5_paths();
    $interval = (int) ($config['sync_on_view_interval'] ?? 300);
    if ($interval <= 0) {
        return;
    }

    $shaFile = $paths['sha_file'];
    $mtime = is_file($shaFile) ? (int) filemtime($shaFile) : 0;
    if ($mtime > 0 && (time() - $mtime) < $interval && is_file($paths['content'] . '/index.html')) {
        return;
    }

    try {
        nv5_sync($config, false);
    } catch (Throwable $e) {
        // Viewing the board should still work from existing cache.
        error_log('nv5-sis sync-on-view: ' . $e->getMessage());
    }
}

function nv5_content_base_href(): string
{
    $script = $_SERVER['SCRIPT_NAME'] ?? '/sis/index.php';
    $dir = str_replace('\\', '/', dirname($script));
    if ($dir === '/' || $dir === '.') {
        return '/content/';
    }
    return rtrim($dir, '/') . '/content/';
}

function nv5_render_board(array $config): void
{
    $paths = nv5_paths();
    nv5_maybe_sync_on_view($config);

    $index = $paths['content'] . '/index.html';
    if (!is_file($index)) {
        try {
            nv5_sync($config, true);
        } catch (Throwable $e) {
            http_response_code(503);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!DOCTYPE html><html lang="nb"><head><meta charset="utf-8"><title>SIS</title></head><body>';
            echo '<h1>Tavlen er ikke klar</h1>';
            echo '<p>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</p>';
            echo '<p>Sjekk config.php og kjør sync.php?token=...</p>';
            echo '</body></html>';
            return;
        }
    }

    $html = file_get_contents($paths['content'] . '/index.html');
    if ($html === false) {
        http_response_code(500);
        echo 'Kunne ikke lese content/index.html';
        return;
    }

    $base = htmlspecialchars(nv5_content_base_href(), ENT_QUOTES, 'UTF-8');
    $baseTag = '<base href="' . $base . '">';

    if (stripos($html, '<base ') === false) {
        if (preg_match('/<head[^>]*>/i', $html)) {
            $html = preg_replace('/<head[^>]*>/i', '$0' . "\n    " . $baseTag, $html, 1);
        } else {
            $html = $baseTag . $html;
        }
    }

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo $html;
}
