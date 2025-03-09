const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const { searchCompanyInfo } = require('./searchService');
const { convertToCSV } = require('./csvService');
const bodyParser = require('body-parser');

// Load environment variables
dotenv.config();

const app = express();
// Renderではポート番号を環境変数から取得
const PORT = process.env.PORT || 3001;

// HTTPサーバーを作成
const server = http.createServer(app);

// WebSocketサーバーを作成
const wss = new WebSocket.Server({ 
  server,
  path: '/ws' // WebSocketのパスを明示的に指定
});

// WebSocketのクライアント接続を管理
const clients = [];

// クライアントへの応答タイムアウト時間
const PING_TIMEOUT = 5000;

// 検索結果を保持するオブジェクト
let searchResults = [];

// WebSocketの接続を処理
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // クライアント状態の拡張
  ws.isAlive = true;
  
  // クライアントごとの最終活動時間
  ws.lastActivity = Date.now();
  
  // 接続確認メッセージを送信
  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'WebSocket接続が確立されました',
    timestamp: Date.now()
  }));
  
  clients.push(ws);
  console.log('接続されているクライアント数:', clients.length);

  // 接続が切断された時の処理
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    // クライアントリストから削除
    const index = clients.indexOf(ws);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    
    // 現在の接続数をログに出力
    console.log(`接続されているクライアント数: ${clients.length}`);
  });
  
  // エラー処理
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // メッセージ受信処理
  ws.on('message', async (message) => {
    try {
      // 受信したメッセージの内容をログに出力
      const messageStr = message.toString();
      console.log('生のメッセージを受信: ', messageStr.length > 100 ? messageStr.substring(0, 100) + '...' : messageStr);
      
      // JSONメッセージをパース
      const data = JSON.parse(messageStr);
      console.log('メッセージをパース: type=', data.type);
      
      // メッセージのタイプに応じた処理
      switch (data.type) {
        case 'client_info':
          console.log('クライアント情報を受信:', data);
          ws.lastActivity = Date.now();
          break;
          
        case 'ping':
          // クライアントからのpingメッセージを受信した場合、pongで応答
          console.log('Pingを受信しました', data);
          ws.isAlive = true; // クライアントが生きていることを確認
          ws.lastActivity = Date.now();
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        case 'search':
          // 検索リクエストの処理
          console.log('検索リクエストを受信しました。', data);
          
          if (!data.companies || !Array.isArray(data.companies) || data.companies.length === 0) {
            console.error('検索対象の会社名が無効です');
            ws.send(JSON.stringify({
              type: 'error',
              message: '検索対象の会社名が無効です。会社名を入力してください。'
            }));
            return;
          }
          
          // 対象会社数をログに出力
          console.log(`検索対象会社数: ${data.companies.length}`);
          console.log(`検索対象会社: ${data.companies}`);
          
          // 重複排除と文字列整形
          const uniqueCompanies = [...new Set(data.companies.map(c => c.trim()))].filter(c => c.length > 0);
          
          console.log(`重複排除後の検索対象会社数: ${uniqueCompanies.length}`);
          
          // 検索開始を通知
          broadcastMessage({
            type: 'search_start',
            totalCompanies: uniqueCompanies.length
          });
          
          // 検索結果を初期化
          searchResults = [];
          
          // 各会社ごとに検索を実行
          for (const company of uniqueCompanies) {
            console.log(`Searching for company: ${company}`);
            
            try {
              // 企業情報を検索
              const result = await searchCompanyInfo(company, (step, stepNumber) => {
                // 検索途中経過を送信
                broadcastMessage({
                  type: 'search_progress',
                  company: company,
                  step: step,
                  stepNumber: stepNumber
                });
              });
              
              // 検索成功の通知
              console.log(`Search complete: ${company} - Success: true `);
              broadcastMessage({
                type: 'search_complete',
                company: company,
                success: true,
                error: null
              });
              
              // 結果を保存
              searchResults.push({
                companyName: company,
                ...result
              });
              
            } catch (error) {
              // 検索失敗の通知
              console.error(`Error searching for ${company}:`, error);
              broadcastMessage({
                type: 'search_progress',
                company: company,
                step: `エラー: ${error.message}`,
                stepNumber: 'error'
              });
              
              console.log(`Search complete: ${company} - Success: false Error: ${error.message}`);
              broadcastMessage({
                type: 'search_complete',
                company: company,
                success: false,
                error: error.message
              });
            }
          }
          
          // 結果をログに出力
          console.log('Search results:', searchResults);
          
          // 全検索完了を通知（結果データも含める）
          const successCount = searchResults.length;
          const errorCount = uniqueCompanies.length - successCount;
          
          broadcastMessage({
            type: 'all_search_complete',
            totalCompanies: uniqueCompanies.length,
            successCount: successCount,
            errorCount: errorCount,
            results: searchResults
          });
          
          break;
          
        case 'test_message':
          // テストメッセージの処理
          console.log('テストメッセージを受信しました:', data);
          ws.send(JSON.stringify({
            type: 'test_response',
            message: 'テストメッセージを受信しました',
            timestamp: Date.now()
          }));
          break;
          
        default:
          console.log(`不明なメッセージタイプ: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, message.toString());
    }
  });
});

// 30秒ごとにクライアントの生存確認
const interval = setInterval(() => {
  console.log('クライアントの生存確認を実行中...');
  const now = Date.now();
  
  clients.forEach(client => {
    // 最後のアクティビティから2分以上経過しているクライアントを切断
    if (now - client.lastActivity > 2 * 60 * 1000) {
      console.log('無応答クライアントを切断します');
      client.terminate();
    }
  });
}, 60 * 1000); // 1分ごとに確認

// サーバー終了時にインターバルをクリア
wss.on('close', () => {
  clearInterval(interval);
});

// クライアントへのメッセージ送信ヘルパー関数
function broadcastMessage(message) {
  const messageStr = JSON.stringify(message);
  console.log('Broadcasting message:', messageStr.length > 200 ? messageStr.substring(0, 200) + '...' : messageStr);
  
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('メッセージのブロードキャスト中にエラーが発生しました:', error);
      }
    }
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// エラーハンドリングミドルウェア
app.use((err, req, res, next) => {
  console.error('Express エラー:', err);
  res.status(500).json({
    error: 'サーバーエラーが発生しました',
    message: process.env.NODE_ENV === 'production' ? 'サーバー内部エラー' : err.message
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// テスト用のエンドポイントを追加
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running correctly' });
});

// API endpoint for company search
app.post('/api/search', async (req, res) => {
  try {
    const { companies } = req.body;
    
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input. Please provide an array of company names.' 
      });
    }
    
    if (companies.length > 500) {
      return res.status(400).json({ 
        error: 'Too many companies. Maximum limit is 500.' 
      });
    }
    
    // 検索開始を通知
    broadcastMessage({
      type: 'search_start',
      totalCompanies: companies.length
    });
    
    const results = await searchCompanyInfo(companies);
    
    // 全体の検索完了を通知
    broadcastMessage({
      type: 'all_search_complete',
      totalCompanies: companies.length,
      successCount: results.filter(r => !r.errorOccurred).length,
      errorCount: results.filter(r => r.errorOccurred).length
    });
    
    res.json({ results });
  } catch (error) {
    console.error('Error searching companies:', error);
    res.status(500).json({ 
      error: 'An error occurred while searching for company information.' 
    });
  }
});

// API endpoint for CSV export
app.post('/api/export-csv', (req, res) => {
  try {
    const { results } = req.body;
    
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: '有効な検索結果がありません' });
    }
    
    // CSVヘッダー
    let csv = '会社名,郵便番号,都道府県,市区町村,番地,代表者役職,代表者名\n';
    
    // CSVデータ行
    results.forEach(item => {
      // カンマを含む場合はダブルクォートで囲む
      const escapedCompanyName = item.companyName ? `"${item.companyName.replace(/"/g, '""')}"` : '';
      const escapedAddress = item.address ? `"${item.address.replace(/"/g, '""')}"` : '';
      
      csv += `${escapedCompanyName},`;
      csv += `${item.postalCode || ''},`;
      csv += `${item.prefecture || ''},`;
      csv += `${item.city || ''},`;
      csv += `${escapedAddress},`;
      csv += `${item.representativeTitle || ''},`;
      csv += `${item.representativeName || ''}\n`;
    });
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=company_info.csv');
    res.send(csv);
    
  } catch (error) {
    console.error('CSVエクスポート中にエラーが発生しました:', error);
    res.status(500).json({ error: 'CSVエクスポート中にエラーが発生しました' });
  }
});

// API: 検索結果を取得
app.get('/api/search-results', (req, res) => {
  console.log('検索結果APIが呼び出されました');
  
  // 最新の検索結果を返す
  res.json({
    status: 'ok',
    results: searchResults
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});

// グローバルに通知関数をエクスポート
global.broadcastMessage = broadcastMessage;

// 環境変数の確認
console.log('環境変数の確認:');
console.log('- GOOGLE_SEARCH_API_KEY:', process.env.GOOGLE_SEARCH_API_KEY ? '設定済み (' + process.env.GOOGLE_SEARCH_API_KEY.substring(0, 6) + '...)' : '未設定');
console.log('- GOOGLE_SEARCH_ENGINE_ID:', process.env.GOOGLE_SEARCH_ENGINE_ID);
console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '設定済み (' + process.env.ANTHROPIC_API_KEY.substring(0, 6) + '...)' : '未設定'); 