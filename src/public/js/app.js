// WebSocketの接続先を環境に応じて変更（HTTPSの場合はWSSを使用）
const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`); 