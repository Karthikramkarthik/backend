<?php
header('Content-Type: application/json');

$db   = 'stock_management';
$user = 'root';
$pass = 'root';
$charset = 'utf8mb4';

$dsn = "mysql:unix_socket=/Applications/MAMP/tmp/mysql/mysql.sock;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
     $pdo = new PDO($dsn, $user, $pass, $options);
     
     $admins = $pdo->query("SELECT id, username, email, role_id FROM admins")->fetchAll();
     $categories = $pdo->query("SELECT id, name, created_by_user_id, created_by_name, created_by_role, created_at FROM categories")->fetchAll();
     
     echo json_encode([
          'success' => true,
          'admins' => $admins,
          'categories' => $categories
     ], JSON_PRETTY_PRINT);
} catch (\PDOException $e) {
     echo json_encode([
         'success' => false,
         'error' => $e->getMessage()
     ]);
}
?>
