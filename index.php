<?php
declare(strict_types=1);

/**
 * Speiler main-branchen fra GitHub og viser tavlen.
 *
 * Intervall styres fra Innstillinger på tavlen (cookie nv5_github_interval).
 * $githubCheckIntervalSeconds er fallback hvis cookie mangler.
 * ?sync=1 tvinger sjekk uansett intervall.
 */

$githubCheckIntervalSeconds = 300;

if (isset($_COOKIE['nv5_github_interval']) && $_COOKIE['nv5_github_interval'] !== '') {
    $githubCheckIntervalSeconds = max(0, min(86400, (int) $_COOKIE['nv5_github_interval']));
}

$forceSync = isset($_GET['sync']) && $_GET['sync'] === '1';

$owner = 'blepman';
$repo = 'nv5-sis';
$branch = 'main';
$ua = 'nv5-sis-server';

$root = __DIR__;
$content = $root . '/content';
$tmp = $root . '/content.tmp';
$shaFile = $root . '/.last-sha';
$checkFile = $root . '/.last-check';
$lockFile = $root . '/.sync.lock';

try {
    $shouldSync = $forceSync || should_check_github($githubCheckIntervalSeconds, $content, $checkFile);
    if ($shouldSync) {
        // Ikke blokker visning hvis en annen request allerede synker
        if (try_sync_lock($lockFile, function () use ($owner, $repo, $branch, $ua, $content, $tmp, $shaFile, $checkFile): void {
            sync_from_github($owner, $repo, $branch, $ua, $content, $tmp, $shaFile);
            file_put_contents($checkFile, (string) time());
        }) === false && !is_file($content . '/index.html')) {
            // Første oppsett: vent kort på lås
            try_sync_lock($lockFile, function () use ($owner, $repo, $branch, $ua, $content, $tmp, $shaFile, $checkFile): void {
                sync_from_github($owner, $repo, $branch, $ua, $content, $tmp, $shaFile);
                file_put_contents($checkFile, (string) time());
            }, true);
        }
    }
    render($content);
} catch (Throwable $e) {
    // Vis cached tavle hvis sync feiler
    if (is_file($content . '/index.html')) {
        render($content);
        exit;
    }
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="nb"><meta charset="utf-8"><title>SIS</title>';
    echo '<h1>Tavlen er ikke klar</h1><p>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</p>';
}

/**
 * @param callable():void $fn
 */
function try_sync_lock(string $lockFile, callable $fn, bool $blocking = false): bool
{
    $fh = fopen($lockFile, 'c+');
    if ($fh === false) {
        return false;
    }

    $flags = $blocking ? LOCK_EX : (LOCK_EX | LOCK_NB);
    if (!flock($fh, $flags)) {
        fclose($fh);
        return false;
    }

    try {
        $fn();
        return true;
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function should_check_github(int $intervalSeconds, string $content, string $checkFile): bool
{
    if (!is_file($content . '/index.html')) {
        return true;
    }
    if ($intervalSeconds <= 0) {
        return true;
    }
    if (!is_file($checkFile)) {
        return true;
    }
    $age = time() - (int) filemtime($checkFile);
    return $age >= $intervalSeconds;
}

function github_get(string $url, string $ua): string
{
    $headers = [
        'Accept: application/vnd.github+json',
        'User-Agent: ' . $ua,
        'X-GitHub-Api-Version: 2022-11-28',
    ];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('cURL: ' . $error);
        }
        if ($status >= 400) {
            throw new RuntimeException('GitHub HTTP ' . $status);
        }
        return $body;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers),
            'timeout' => 20,
            'ignore_errors' => true,
        ],
    ]);
    $body = file_get_contents($url, false, $ctx);
    if ($body === false) {
        throw new RuntimeException('Kunne ikke hente ' . $url);
    }
    return $body;
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
        $path = $dir . '/' . $item;
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
        throw new RuntimeException('Kunne ikke lage ' . $dst);
    }
    foreach (scandir($src) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $from = $src . '/' . $item;
        $to = $dst . '/' . $item;
        if (is_dir($from) && !is_link($from)) {
            copy_tree($from, $to);
        } elseif (!copy($from, $to)) {
            throw new RuntimeException('Kunne ikke kopiere ' . $from);
        }
    }
}

function sync_from_github(
    string $owner,
    string $repo,
    string $branch,
    string $ua,
    string $content,
    string $tmp,
    string $shaFile
): void {
    $o = rawurlencode($owner);
    $r = rawurlencode($repo);
    $b = rawurlencode($branch);

    $meta = json_decode(github_get("https://api.github.com/repos/{$o}/{$r}/commits/{$b}", $ua), true);
    $remote = is_array($meta) ? (string) ($meta['sha'] ?? '') : '';
    if ($remote === '') {
        throw new RuntimeException('Fant ikke commit på main');
    }

    $local = is_file($shaFile) ? trim((string) file_get_contents($shaFile)) : '';
    if ($remote === $local && is_file($content . '/index.html')) {
        return;
    }

    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('PHP ext-zip mangler');
    }

    $zipData = github_get("https://api.github.com/repos/{$o}/{$r}/zipball/{$b}", $ua);
    $zipPath = sys_get_temp_dir() . '/nv5-' . bin2hex(random_bytes(6)) . '.zip';
    $extract = sys_get_temp_dir() . '/nv5-x-' . bin2hex(random_bytes(6));
    file_put_contents($zipPath, $zipData);

    try {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new RuntimeException('Kunne ikke åpne zip');
        }
        mkdir($extract, 0755, true);
        $zip->extractTo($extract);
        $zip->close();

        $entries = array_values(array_filter(scandir($extract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1) {
            throw new RuntimeException('Uventet zip-struktur');
        }

        rm_tree($tmp);
        copy_tree($extract . '/' . $entries[0], $tmp);
        if (!is_file($tmp . '/index.html')) {
            throw new RuntimeException('main mangler index.html');
        }

        $old = $content . '.old';
        rm_tree($old);
        if (is_dir($content)) {
            rename($content, $old);
        }
        rename($tmp, $content);
        rm_tree($old);
        file_put_contents($shaFile, $remote . "\n");
    } finally {
        @unlink($zipPath);
        rm_tree($extract);
        rm_tree($tmp);
    }
}

function render(string $content): void
{
    $html = file_get_contents($content . '/index.html');
    if ($html === false) {
        throw new RuntimeException('Kunne ikke lese content/index.html');
    }

    $dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/sis/index.php'));
    $baseHref = ($dir === '/' || $dir === '.') ? '/content/' : rtrim($dir, '/') . '/content/';
    $base = '<base href="' . htmlspecialchars($baseHref, ENT_QUOTES, 'UTF-8') . '">';

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
