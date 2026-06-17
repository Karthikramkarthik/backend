<?php
header('Content-Type: application/json');

try {
    $output = shell_exec('lsof -i :3000 2>&1');
    $ps = shell_exec('ps aux | grep node 2>&1');
    
    echo json_encode([
        'success' => true,
        'lsof' => $output,
        'ps' => $ps
    ]);
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
