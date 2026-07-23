<?php
declare(strict_types=1);

/**
 * Speiler server-branchen til /sis/, deretter main til content/, og viser tavlen.
 *
 * Serverfiler (index.php, .htaccess, …):
 *   - Sjekkes ca. hver time
 *   - ?sync=server eller ?sync=both|1 tvinger sjekk
 *
 * Tavle (main → content/):
 *   - Intervall fra cookie nv5_github_interval (Innstillinger)
 *   - ?sync=main eller ?sync=both|1 tvinger sjekk
 */

$owner = 'blepman';
$repo = 'nv5-sis';
$ua = 'nv5-sis-server';

$serverBranch = 'server';
$boardBranch = 'main';

// Server-branch: fast timeintervall
$serverCheckIntervalSeconds = 3600;

// Tavle/main: cookie eller fallback
$boardCheckIntervalSeconds = 300;
if (isset($_COOKIE['nv5_github_interval']) && $_COOKIE['nv5_github_interval'] !== '') {
    $boardCheckIntervalSeconds = max(0, min(86400, (int) $_COOKIE['nv5_github_interval']));
}

$syncParam = isset($_GET['sync']) ? strtolower(trim((string) $_GET['sync'])) : '';
$forceServerSync = in_array($syncParam, ['server', 'both', '1', 'all'], true);
$forceBoardSync = in_array($syncParam, ['main', 'board', 'both', '1', 'all'], true);

$root = __DIR__;
$content = $root . '/content';
$contentTmp = $root . '/content.tmp';
$boardShaFile = $root . '/.last-sha';
$boardCheckFile = $root . '/.last-check';
$boardLockFile = $root . '/.sync.lock';

$serverShaFile = $root . '/.server-sha';
$serverCheckFile = $root . '/.server-check';
$serverLockFile = $root . '/.server.lock';

try {
    // 1) Speil server-branchen inn i /sis/ (uten å røre content/)
    $shouldSyncServer = $forceServerSync || should_check_github(
        $serverCheckIntervalSeconds,
        $serverShaFile,
        $serverCheckFile
    );
    if ($shouldSyncServer) {
        $ran = try_sync_lock($serverLockFile, function () use (
            $owner,
            $repo,
            $serverBranch,
            $ua,
            $root,
            $serverShaFile,
            $serverCheckFile
        ): void {
            sync_server_branch($owner, $repo, $serverBranch, $ua, $root, $serverShaFile);
            file_put_contents($serverCheckFile, (string) time());
        });
        if ($ran === false && !is_file($serverShaFile)) {
            try_sync_lock($serverLockFile, function () use (
                $owner,
                $repo,
                $serverBranch,
                $ua,
                $root,
                $serverShaFile,
                $serverCheckFile
            ): void {
                sync_server_branch($owner, $repo, $serverBranch, $ua, $root, $serverShaFile);
                file_put_contents($serverCheckFile, (string) time());
            }, true);
        }
    }

    // 2) Speil main → content/
    $shouldSyncBoard = $forceBoardSync || should_check_github(
        $boardCheckIntervalSeconds,
        $content . '/index.html',
        $boardCheckFile
    );
    if ($shouldSyncBoard) {
        $ran = try_sync_lock($boardLockFile, function () use (
            $owner,
            $repo,
            $boardBranch,
            $ua,
            $content,
            $contentTmp,
            $boardShaFile,
            $boardCheckFile
        ): void {
            sync_board_from_github(
                $owner,
                $repo,
                $boardBranch,
                $ua,
                $content,
                $contentTmp,
                $boardShaFile
            );
            file_put_contents($boardCheckFile, (string) time());
        });
        if ($ran === false && !is_file($content . '/index.html')) {
            try_sync_lock($boardLockFile, function () use (
                $owner,
                $repo,
                $boardBranch,
                $ua,
                $content,
                $contentTmp,
                $boardShaFile,
                $boardCheckFile
            ): void {
                sync_board_from_github(
                    $owner,
                    $repo,
                    $boardBranch,
                    $ua,
                    $content,
                    $contentTmp,
                    $boardShaFile
                );
                file_put_contents($boardCheckFile, (string) time());
            }, true);
        }
    }

    render($content);
} catch (Throwable $e) {
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

function should_check_github(
    int $intervalSeconds,
    string $readyMarker,
    string $checkFile
): bool {
    // Server: readyMarker = .server-sha. Board: readyMarker = content/index.html
    if (!is_file($readyMarker)) {
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

function write_atomic(string $path, string $data): void
{
    $dir = dirname($path);
    $tmp = $dir . '/.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($tmp, $data) === false) {
        throw new RuntimeException('Kunne ikke skrive ' . $tmp);
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('Kunne ikke erstatte ' . $path);
    }
}

function copy_atomic(string $from, string $to): void
{
    $data = file_get_contents($from);
    if ($data === false) {
        throw new RuntimeException('Kunne ikke lese ' . $from);
    }
    write_atomic($to, $data);
}

/**
 * Filer/mapper som aldri skal overskrives/slettes av server-sync.
 *
 * @return list<string>
 */
function server_sync_preserve(): array
{
    return [
        'content',
        'content.tmp',
        'content.old',
        '.last-sha',
        '.last-check',
        '.sync.lock',
        '.server-sha',
        '.server-check',
        '.server.lock',
        '.git',
    ];
}

function sync_server_branch(
    string $owner,
    string $repo,
    string $branch,
    string $ua,
    string $root,
    string $shaFile
): void {
    $o = rawurlencode($owner);
    $r = rawurlencode($repo);
    $b = rawurlencode($branch);

    $meta = json_decode(github_get("https://api.github.com/repos/{$o}/{$r}/commits/{$b}", $ua), true);
    $remote = is_array($meta) ? (string) ($meta['sha'] ?? '') : '';
    if ($remote === '') {
        throw new RuntimeException('Fant ikke commit på server');
    }

    $local = is_file($shaFile) ? trim((string) file_get_contents($shaFile)) : '';
    if ($remote === $local && is_file($root . '/index.php')) {
        return;
    }

    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('PHP ext-zip mangler');
    }

    $zipData = github_get("https://api.github.com/repos/{$o}/{$r}/zipball/{$b}", $ua);
    $zipPath = sys_get_temp_dir() . '/nv5-s-' . bin2hex(random_bytes(6)) . '.zip';
    $extract = sys_get_temp_dir() . '/nv5-sx-' . bin2hex(random_bytes(6));
    file_put_contents($zipPath, $zipData);

    try {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new RuntimeException('Kunne ikke åpne server-zip');
        }
        mkdir($extract, 0755, true);
        $zip->extractTo($extract);
        $zip->close();

        $entries = array_values(array_filter(scandir($extract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1) {
            throw new RuntimeException('Uventet server-zip-struktur');
        }

        $source = $extract . '/' . $entries[0];
        if (!is_file($source . '/index.php')) {
            throw new RuntimeException('server mangler index.php');
        }

        $preserve = array_fill_keys(server_sync_preserve(), true);
        foreach (scandir($source) ?: [] as $item) {
            if ($item === '.' || $item === '..' || isset($preserve[$item])) {
                continue;
            }
            $from = $source . '/' . $item;
            $to = $root . '/' . $item;
            if (is_dir($from) && !is_link($from)) {
                // Mapper fra server-branchen (sjeldent) – kopier innhold
                copy_tree($from, $to);
            } else {
                copy_atomic($from, $to);
            }
        }

        file_put_contents($shaFile, $remote . "\n");
    } finally {
        @unlink($zipPath);
        rm_tree($extract);
    }
}

function sync_board_from_github(
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
    $zipPath = sys_get_temp_dir() . '/nv5-b-' . bin2hex(random_bytes(6)) . '.zip';
    $extract = sys_get_temp_dir() . '/nv5-bx-' . bin2hex(random_bytes(6));
    file_put_contents($zipPath, $zipData);

    try {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new RuntimeException('Kunne ikke åpne main-zip');
        }
        mkdir($extract, 0755, true);
        $zip->extractTo($extract);
        $zip->close();

        $entries = array_values(array_filter(scandir($extract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1) {
            throw new RuntimeException('Uventet main-zip-struktur');
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
