<?php
declare(strict_types=1);

/**
 * Speiler server-branchen til /sis/, deretter main til content/, og viser tavlen.
 *
 * Serverfiler (index.php, .htaccess, …):
 *   - Sjekkes ca. hver time
 *   - ?sync=server|both tvinger sjekk (rate-limitet; valgfri nøkkel)
 *
 * Tavle (main → content/):
 *   - Intervall fra cookie nv5_github_interval (Innstillinger), minimum 60s
 *   - ?sync=main|both tvinger sjekk (rate-limitet)
 */

$owner = 'blepman';
$repo = 'nv5-sis';
$ua = 'nv5-sis-server';

$serverBranch = 'server';
$boardBranch = 'main';

// Server-branch: fast timeintervall
$serverCheckIntervalSeconds = 3600;

// Forced sync rate limits (per IP)
$forceBoardCooldownSeconds = 45;
$forceServerCooldownSeconds = 120;

// Tavle/main: cookie eller fallback (minimum 60s — bruk ?sync= for umiddelbar sjekk)
$boardCheckIntervalSeconds = 300;
if (isset($_COOKIE['nv5_github_interval']) && $_COOKIE['nv5_github_interval'] !== '') {
    $boardCheckIntervalSeconds = normalize_board_interval((int) $_COOKIE['nv5_github_interval']);
}

$syncParam = isset($_GET['sync']) ? strtolower(trim((string) $_GET['sync'])) : '';
$forceServerSync = in_array($syncParam, ['server', 'both', '1', 'all'], true);
$forceBoardSync = in_array($syncParam, ['main', 'board', 'both', '1', 'all'], true);
$syncKey = isset($_GET['key']) ? (string) $_GET['key'] : '';

$root = __DIR__;
$stateDir = ensure_state_dir($root);
migrate_and_scrub_webroot_state($root, $stateDir);

$content = $root . '/content';
$contentTmp = $root . '/content.tmp';
$boardShaFile = $stateDir . '/board-sha';
$boardCheckFile = $stateDir . '/board-check';
$boardLockFile = $stateDir . '/board.lock';

$serverShaFile = $stateDir . '/server-sha';
$serverCheckFile = $stateDir . '/server-check';
$serverLockFile = $stateDir . '/server.lock';

if ($forceServerSync || $forceBoardSync) {
    $gate = gate_forced_sync(
        $stateDir,
        $forceServerSync,
        $forceBoardSync,
        $syncKey,
        $forceBoardCooldownSeconds,
        $forceServerCooldownSeconds
    );
    $forceServerSync = $gate['server'];
    $forceBoardSync = $gate['board'];
    if ($gate['retry_after'] > 0) {
        header('Retry-After: ' . (string) $gate['retry_after']);
    }
}

try {
    // 1) Speil server-branchen inn i /sis/ (uten å røre content/)
    $shouldSyncServer = $forceServerSync
        || !server_webroot_complete($root)
        || should_check_github(
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
            $serverCheckFile,
            $forceServerSync
        ): void {
            sync_server_branch(
                $owner,
                $repo,
                $serverBranch,
                $ua,
                $root,
                $serverShaFile,
                $forceServerSync
            );
            file_put_contents($serverCheckFile, (string) time());
        });
        if ($ran === false && (!is_file($serverShaFile) || !server_webroot_complete($root))) {
            try_sync_lock($serverLockFile, function () use (
                $owner,
                $repo,
                $serverBranch,
                $ua,
                $root,
                $serverShaFile,
                $serverCheckFile,
                $forceServerSync
            ): void {
                sync_server_branch(
                    $owner,
                    $repo,
                    $serverBranch,
                    $ua,
                    $root,
                    $serverShaFile,
                    $forceServerSync || !server_webroot_complete($root)
                );
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

    render($content, $boardShaFile);
} catch (Throwable $e) {
    if (is_file($content . '/index.html')) {
        render($content, $boardShaFile);
        exit;
    }
    http_response_code(503);
    send_security_headers();
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="nb"><meta charset="utf-8"><title>SIS</title>';
    echo '<h1>Tavlen er ikke klar</h1><p>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</p>';
}

function normalize_board_interval(int $seconds): int
{
    if ($seconds < 60) {
        return 60;
    }
    return min(86400, $seconds);
}

/**
 * State/lock utenfor webroot — nginx trenger ikke egne deny-regler for disse.
 * Bruker system-temp (ikke sibling av /sis/, som ofte fortsatt er public).
 */
function ensure_state_dir(string $root): string
{
    $candidates = [
        sys_get_temp_dir() . '/nv5-sis-' . substr(hash('sha256', $root), 0, 16),
        // Fallback hvis temp er utilgjengelig (sjeldent)
        dirname($root) . '/.nv5-sis-state-' . substr(hash('sha256', $root), 0, 8),
    ];
    foreach ($candidates as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            continue;
        }
        if (is_dir($dir) && is_writable($dir)) {
            return $dir;
        }
    }
    throw new RuntimeException('Kunne ikke lage state-mappe utenfor webroot');
}

function client_ip(): string
{
    $ip = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    return $ip !== '' ? $ip : 'unknown';
}

/**
 * Valgfri delt hemmelighet for ?sync=server|both.
 * Sett miljøvariabel NV5_SYNC_SERVER_KEY, eller fil sync-server-secret i state-mappen.
 */
function sync_server_secret(string $stateDir): string
{
    $fromEnv = trim((string) (getenv('NV5_SYNC_SERVER_KEY') ?: ''));
    if ($fromEnv !== '') {
        return $fromEnv;
    }

    $file = $stateDir . '/sync-server-secret';
    if (is_readable($file)) {
        return trim((string) file_get_contents($file));
    }

    return '';
}

function log_sync_event(string $stateDir, string $message): void
{
    try {
        $line = sprintf(
            "[%s] ip=%s %s\n",
            gmdate('c'),
            client_ip(),
            $message
        );
        @file_put_contents($stateDir . '/sync-audit.log', $line, FILE_APPEND | LOCK_EX);
    } catch (Throwable $e) {
        // Best-effort audit logging.
    }
}

/**
 * Rate-limit forced sync per IP. Valgfri nøkkel for server-sync.
 * Soft-deny: slår av force-flagg (planlagt intervall gjelder fortsatt).
 *
 * @return array{server:bool,board:bool,retry_after:int}
 */
function gate_forced_sync(
    string $stateDir,
    bool $wantServer,
    bool $wantBoard,
    string $providedKey,
    int $boardCooldownSeconds,
    int $serverCooldownSeconds
): array {
    $allowServer = $wantServer;
    $allowBoard = $wantBoard;
    $retryAfter = 0;
    $ip = client_ip();
    $ipKey = hash('sha256', $ip);
    $now = time();

    if ($allowServer) {
        $secret = sync_server_secret($stateDir);
        if ($secret !== '') {
            if ($providedKey === '' || !hash_equals($secret, $providedKey)) {
                log_sync_event($stateDir, 'deny kind=server reason=bad_or_missing_key');
                $allowServer = false;
                $retryAfter = max($retryAfter, 60);
            }
        }
    }

    if ($allowServer) {
        $stampFile = $stateDir . '/force-sync-server-' . $ipKey . '.stamp';
        $last = is_readable($stampFile) ? (int) trim((string) @file_get_contents($stampFile)) : 0;
        if ($last > 0 && ($now - $last) < $serverCooldownSeconds) {
            $wait = max(1, $serverCooldownSeconds - ($now - $last));
            log_sync_event($stateDir, "deny kind=server reason=rate_limit retry_after={$wait}");
            $allowServer = false;
            $retryAfter = max($retryAfter, $wait);
        } else {
            @file_put_contents($stampFile, (string) $now, LOCK_EX);
            log_sync_event($stateDir, 'allow kind=server');
        }
    }

    if ($allowBoard) {
        $stampFile = $stateDir . '/force-sync-board-' . $ipKey . '.stamp';
        $last = is_readable($stampFile) ? (int) trim((string) @file_get_contents($stampFile)) : 0;
        if ($last > 0 && ($now - $last) < $boardCooldownSeconds) {
            $wait = max(1, $boardCooldownSeconds - ($now - $last));
            log_sync_event($stateDir, "deny kind=board reason=rate_limit retry_after={$wait}");
            $allowBoard = false;
            $retryAfter = max($retryAfter, $wait);
        } else {
            @file_put_contents($stampFile, (string) $now, LOCK_EX);
            log_sync_event($stateDir, 'allow kind=board');
        }
    }

    return [
        'server' => $allowServer,
        'board' => $allowBoard,
        'retry_after' => $retryAfter,
    ];
}

/**
 * Flytt gamle state-filer ut av /sis/ og fjern README/.gitignore som ikke skal serveres.
 *
 * @return array<string, string> webroot-navn => state-filnavn
 */
function legacy_webroot_state_map(): array
{
    return [
        '.last-sha' => 'board-sha',
        '.last-check' => 'board-check',
        '.sync.lock' => 'board.lock',
        '.server-sha' => 'server-sha',
        '.server-check' => 'server-check',
        '.server.lock' => 'server.lock',
    ];
}

/**
 * @return list<string>
 */
function server_sync_skip_web(): array
{
    return ['README.md', '.gitignore'];
}

/**
 * Filer som alltid skal ligge i /sis/ etter server-sync.
 *
 * @return list<string>
 */
function server_sync_required_files(): array
{
    return ['index.php', '.htaccess', 'nginx-sis-pwa.conf'];
}

function server_webroot_complete(string $root): bool
{
    foreach (server_sync_required_files() as $name) {
        if (!is_file($root . '/' . $name)) {
            return false;
        }
    }
    return true;
}

function migrate_and_scrub_webroot_state(string $root, string $stateDir): void
{
    foreach (legacy_webroot_state_map() as $oldName => $newName) {
        $from = $root . '/' . $oldName;
        $to = $stateDir . '/' . $newName;
        if (is_file($from)) {
            if (!is_file($to)) {
                if (!@rename($from, $to)) {
                    @copy($from, $to);
                    @unlink($from);
                }
            } else {
                @unlink($from);
            }
        }
    }
    foreach (server_sync_skip_web() as $name) {
        $path = $root . '/' . $name;
        if (is_file($path)) {
            @unlink($path);
        }
    }
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

/**
 * Relativ sti uten .., absolutte stier eller skjulte path-segmenter (unntatt tillatte).
 */
function is_safe_relative_path(string $relative): bool
{
    if ($relative === '' || str_contains($relative, "\0")) {
        return false;
    }
    $relative = str_replace('\\', '/', $relative);
    if ($relative[0] === '/' || preg_match('#^[a-zA-Z]:#', $relative) === 1) {
        return false;
    }
    foreach (explode('/', $relative) as $part) {
        if ($part === '..') {
            return false;
        }
    }
    return true;
}

/**
 * @return list<string>
 */
function board_allowed_extensions(): array
{
    return ['html', 'css', 'js', 'woff2', 'png', 'webmanifest', 'json'];
}

function board_file_allowed(string $basename): bool
{
    if ($basename === '' || $basename[0] === '.') {
        return false;
    }
    $ext = strtolower(pathinfo($basename, PATHINFO_EXTENSION));
    return in_array($ext, board_allowed_extensions(), true);
}

/**
 * Kopier tre for server-sync. Hopper over symlinks.
 */
function copy_tree(string $src, string $dst): void
{
    if (is_link($src)) {
        return;
    }
    if (!is_dir($dst) && !mkdir($dst, 0755, true) && !is_dir($dst)) {
        throw new RuntimeException('Kunne ikke lage ' . $dst);
    }
    foreach (scandir($src) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        if (!is_safe_relative_path($item)) {
            continue;
        }
        $from = $src . '/' . $item;
        $to = $dst . '/' . $item;
        if (is_link($from)) {
            continue;
        }
        if (is_dir($from)) {
            copy_tree($from, $to);
        } elseif (is_file($from)) {
            copy_atomic($from, $to);
        }
    }
}

/**
 * Kopier kun allowlistede tavlefiler fra main-zip til destinasjon.
 */
function copy_board_tree(string $src, string $dst): void
{
    if (is_link($src) || !is_dir($src)) {
        throw new RuntimeException('Ugyldig main-kilde');
    }
    if (!is_dir($dst) && !mkdir($dst, 0755, true) && !is_dir($dst)) {
        throw new RuntimeException('Kunne ikke lage ' . $dst);
    }
    foreach (scandir($src) ?: [] as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        if ($item[0] === '.' || !is_safe_relative_path($item)) {
            continue;
        }
        $from = $src . '/' . $item;
        $to = $dst . '/' . $item;
        if (is_link($from)) {
            continue;
        }
        if (is_dir($from)) {
            copy_board_tree($from, $to);
            // Fjern tomme mapper som ikke fikk filer
            $children = array_values(array_filter(
                scandir($to) ?: [],
                static fn(string $n): bool => $n !== '.' && $n !== '..'
            ));
            if ($children === []) {
                @rmdir($to);
            }
        } elseif (is_file($from) && board_file_allowed($item)) {
            copy_atomic($from, $to);
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
    if (is_link($from)) {
        throw new RuntimeException('Symlink avvist: ' . $from);
    }
    $data = file_get_contents($from);
    if ($data === false) {
        throw new RuntimeException('Kunne ikke lese ' . $from);
    }
    write_atomic($to, $data);
}

/**
 * Pakk ut zip til $extractDir. Avviser path traversal, absolutte stier og symlinks.
 */
function extract_zip_safe(string $zipPath, string $extractDir): void
{
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        throw new RuntimeException('Kunne ikke åpne zip');
    }

    if (!is_dir($extractDir) && !mkdir($extractDir, 0755, true) && !is_dir($extractDir)) {
        $zip->close();
        throw new RuntimeException('Kunne ikke lage ' . $extractDir);
    }

    try {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if ($name === false || $name === '') {
                continue;
            }
            $name = str_replace('\\', '/', $name);
            if (!is_safe_relative_path($name)) {
                throw new RuntimeException('Utrygg zip-sti');
            }

            if ($zip->getExternalAttributesIndex($i, $opsys, $attr) && $opsys === ZipArchive::OPSYS_UNIX) {
                $type = ($attr >> 16) & 0170000;
                // 0120000 = symlink
                if ($type === 0120000) {
                    throw new RuntimeException('Symlink i zip avvist');
                }
            }

            $target = $extractDir . '/' . $name;
            if (str_ends_with($name, '/')) {
                if (!is_dir($target) && !mkdir($target, 0755, true) && !is_dir($target)) {
                    throw new RuntimeException('Kunne ikke lage mappe i zip');
                }
                continue;
            }

            $parent = dirname($target);
            if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
                throw new RuntimeException('Kunne ikke lage mappe i zip');
            }

            $data = $zip->getFromIndex($i);
            if ($data === false) {
                throw new RuntimeException('Kunne ikke lese zip-post');
            }
            if (file_put_contents($target, $data) === false) {
                throw new RuntimeException('Kunne ikke skrive zip-post');
            }
        }
    } finally {
        $zip->close();
    }
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
        // Legacy webroot-state (skrubbes bort; ikke overskriv hvis de dukker opp)
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
    string $shaFile,
    bool $force = false
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
    // Ikke hopp over når påkrevde filer mangler (f.eks. slettet .htaccess),
    // eller når sync er tvunget — ellers blir webroot ufullstendig.
    if (!$force && $remote === $local && server_webroot_complete($root)) {
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
        extract_zip_safe($zipPath, $extract);

        $entries = array_values(array_filter(scandir($extract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1 || !is_safe_relative_path($entries[0])) {
            throw new RuntimeException('Uventet server-zip-struktur');
        }

        $source = $extract . '/' . $entries[0];
        if (is_link($source) || !is_dir($source)) {
            throw new RuntimeException('Ugyldig server-zip-rot');
        }
        if (!is_file($source . '/index.php')) {
            throw new RuntimeException('server mangler index.php');
        }

        $preserve = array_fill_keys(server_sync_preserve(), true);
        $skipWeb = array_fill_keys(server_sync_skip_web(), true);
        $copied = [];
        foreach (scandir($source) ?: [] as $item) {
            if ($item === '.' || $item === '..' || isset($preserve[$item]) || isset($skipWeb[$item])) {
                continue;
            }
            if (!is_safe_relative_path($item)) {
                continue;
            }
            $from = $source . '/' . $item;
            $to = $root . '/' . $item;
            if (is_link($from)) {
                continue;
            }
            if (is_dir($from)) {
                copy_tree($from, $to);
                $copied[] = $item . '/';
            } elseif (is_file($from)) {
                copy_atomic($from, $to);
                $copied[] = $item;
            }
        }

        foreach (server_sync_required_files() as $required) {
            if (!is_file($root . '/' . $required)) {
                throw new RuntimeException('Server-sync mangler påkrevd fil: ' . $required);
            }
        }

        // Fjern eventuelle README/.gitignore som lå igjen fra tidligere speil
        foreach (server_sync_skip_web() as $name) {
            $leftover = $root . '/' . $name;
            if (is_file($leftover)) {
                @unlink($leftover);
            }
        }

        file_put_contents($shaFile, $remote . "\n");
        log_sync_event(
            dirname($shaFile),
            'server_sync sha=' . substr($remote, 0, 12) . ' files=' . implode(',', $copied)
        );
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
        extract_zip_safe($zipPath, $extract);

        $entries = array_values(array_filter(scandir($extract) ?: [], fn($n) => $n !== '.' && $n !== '..'));
        if (count($entries) !== 1 || !is_safe_relative_path($entries[0])) {
            throw new RuntimeException('Uventet main-zip-struktur');
        }

        $source = $extract . '/' . $entries[0];
        if (is_link($source) || !is_dir($source)) {
            throw new RuntimeException('Ugyldig main-zip-rot');
        }

        rm_tree($tmp);
        copy_board_tree($source, $tmp);
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

function send_security_headers(): void
{
    // Én CSP her. Unngå å sette en andre CSP i nginx (browsere håndhever begge).
    header(
        "Content-Security-Policy: default-src 'self'; " .
        "base-uri 'self'; " .
        "form-action 'self'; " .
        "frame-ancestors 'none'; " .
        "object-src 'none'; " .
        "script-src 'self'; " .
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " .
        "font-src 'self' https://fonts.gstatic.com data:; " .
        "img-src 'self' data: https:; " .
        "connect-src 'self' https://api.entur.io; " .
        "worker-src 'none'; " .
        "manifest-src 'self'; " .
        'upgrade-insecure-requests'
    );
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Cross-Origin-Opener-Policy: same-origin');

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
    if ($https) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}

function board_asset_version(string $boardShaFile, string $content): string
{
    if (is_readable($boardShaFile)) {
        $sha = trim((string) file_get_contents($boardShaFile));
        if ($sha !== '') {
            return substr($sha, 0, 12);
        }
    }
    $index = $content . '/index.html';
    if (is_file($index)) {
        return (string) filemtime($index);
    }
    return (string) time();
}

/**
 * Append ?v=… to local css/js/font/manifest URLs so browsers pick up new tavle files.
 */
function bust_board_asset_urls(string $html, string $version): string
{
    $v = rawurlencode($version);
    $out = preg_replace_callback(
        '/\b((?:href|src)=["\'])([^"\']+\.(?:css|js|webmanifest|woff2))(["\'])/i',
        static function (array $m) use ($v): string {
            $url = $m[2];
            if (str_contains($url, '://') || str_starts_with($url, '//')) {
                return $m[0];
            }
            if (preg_match('/([?&])v=[^&]*/', $url) === 1) {
                $url = (string) preg_replace('/([?&])v=[^&]*/', '$1v=' . $v, $url, 1);
            } else {
                $url .= (str_contains($url, '?') ? '&' : '?') . 'v=' . $v;
            }
            return $m[1] . $url . $m[3];
        },
        $html
    );
    return is_string($out) ? $out : $html;
}

function render(string $content, string $boardShaFile = ''): void
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
            $html = preg_replace('/<head[^>]*>/i', '$0' . "\n    " . $base, $html, 1) ?? $html;
        } else {
            $html = $base . $html;
        }
    }

    $html = bust_board_asset_urls($html, board_asset_version($boardShaFile, $content));

    send_security_headers();
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo $html;
}
