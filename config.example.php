<?php
/**
 * Copy this file to config.php on the server and fill in values.
 * config.php must not be committed.
 */
return [
    // GitHub repo that holds the SIS UI on branch "main"
    'github_owner' => 'blepman',
    'github_repo' => 'nv5-sis',
    'github_branch' => 'main',

    // Optional: raises GitHub API rate limits. Leave empty for public anonymous access.
    'github_token' => '',

    // Shared secret for sync.php?token=...
    'sync_token' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',

    // How often index.php may attempt a background sync (seconds). Cron should still call sync.php.
    'sync_on_view_interval' => 300,

    // User-Agent for GitHub API
    'user_agent' => 'nv5-sis-server',
];
