<?php
declare(strict_types=1);

require __DIR__ . '/lib/sync.php';

try {
    $config = nv5_load_config();
    nv5_render_board($config);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="nb"><head><meta charset="utf-8"><title>SIS-feil</title></head><body>';
    echo '<h1>Kunne ikke starte tavlen</h1>';
    echo '<p>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</p>';
    echo '</body></html>';
}
