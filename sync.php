<?php
declare(strict_types=1);

require __DIR__ . '/lib/sync.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $config = nv5_load_config();
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

    $force = isset($_GET['force']) && $_GET['force'] === '1';
    $result = nv5_sync($config, $force);
    echo json_encode([
        'ok' => true,
        'updated' => $result['updated'],
        'sha' => $result['sha'],
        'message' => $result['message'],
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
