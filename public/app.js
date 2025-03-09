// DOM要素の取得
const companyInput = document.getElementById('company-input');
const searchButton = document.getElementById('search-button');
const clearButton = document.getElementById('clear-button');
const processSection = document.getElementById('process-section');
const processContainer = document.getElementById('process-container');
const resultsSection = document.getElementById('results-section');
const resultsTbody = document.getElementById('results-tbody');
const exportCsvButton = document.getElementById('export-csv-button');
const copyTableButton = document.getElementById('copy-table-button');
const loadingModal = document.getElementById('loading-modal');
const progressText = document.getElementById('progress-text');

// グローバル変数
let searchResults = [];
let processedCount = 0;
let totalCount = 0;
let websocket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// WebSocketを開始
function setupWebSocket() {
  // 既存の接続を閉じる
  if (websocket && websocket.readyState !== WebSocket.CLOSED) {
    websocket.close();
  }
  
  // 新しい接続を作成 - Railway対応
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // ローカル環境とRailway環境の両方に対応
  const host = window.location.hostname;
  // ローカル環境の場合のみポート番号を指定
  const port = host === 'localhost' || host === '127.0.0.1' ? ':3001' : '';
  const wsUrl = `${protocol}//${host}${port}`;
  
  console.log(`Connecting to WebSocket at: ${wsUrl}`);
  
  try {
    websocket = new WebSocket(wsUrl);
    
    // 接続が開いたとき
    websocket.onopen = () => {
      console.log('WebSocket接続が確立されました');
      // 接続成功したらカウンターをリセット
      reconnectAttempts = 0;
      
      // 接続確認メッセージを送信
      websocket.send(JSON.stringify({ 
        type: 'client_connected',
        clientInfo: {
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString()
        }
      }));
      
      // プロセスセクションにメッセージを表示
      updateConnectionStatus('接続済み', 'connected');
    };
    
    // メッセージを受信したとき
    websocket.onmessage = (event) => {
      try {
        console.log('WebSocketメッセージを受信:', event.data);
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('WebSocketメッセージの解析エラー:', error);
      }
    };
    
    // エラーが発生したとき
    websocket.onerror = (error) => {
      console.error('WebSocketエラー:', error);
      updateConnectionStatus('接続エラー', 'error');
    };
    
    // 接続が閉じたとき
    websocket.onclose = (event) => {
      console.log(`WebSocket接続が閉じられました (コード: ${event.code})`);
      
      // 正常なクローズでなければ再接続を試みる
      if (event.code !== 1000 && event.code !== 1001) {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const timeout = Math.min(1000 * reconnectAttempts, 5000);
          console.log(`${timeout}ms後に再接続を試みます (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          updateConnectionStatus(`再接続中... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'reconnecting');
          
          setTimeout(setupWebSocket, timeout);
        } else {
          console.error('WebSocket再接続の試行回数が上限に達しました');
          updateConnectionStatus('接続失敗', 'failed');
        }
      } else {
        updateConnectionStatus('切断済み', 'disconnected');
      }
    };
  } catch (error) {
    console.error('WebSocket接続の初期化に失敗:', error);
    updateConnectionStatus('接続失敗', 'failed');
  }
  
  return websocket;
}

// 接続状態の表示を更新
function updateConnectionStatus(message, status) {
  // すでに接続ステータス要素があれば更新、なければ作成
  let statusElement = document.getElementById('connection-status');
  
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'connection-status';
    statusElement.className = 'connection-status';
    
    // ステータスをヘッダーの下に表示
    const header = document.querySelector('header');
    header.parentNode.insertBefore(statusElement, header.nextSibling);
  }
  
  // クラスを更新
  statusElement.className = `connection-status ${status}`;
  statusElement.innerHTML = `<i class="fas fa-${getStatusIcon(status)}"></i> サーバー状態: ${message}`;
}

// ステータスアイコンを取得
function getStatusIcon(status) {
  switch (status) {
    case 'connected': return 'check-circle';
    case 'disconnected': return 'times-circle';
    case 'reconnecting': return 'sync fa-spin';
    case 'error': case 'failed': return 'exclamation-triangle';
    default: return 'question-circle';
  }
}

// WebSocketメッセージを処理
function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'connection_established':
      console.log('サーバーから接続確認を受信:', data.message);
      break;
      
    case 'search_start':
      // 検索開始の通知
      processedCount = 0;
      totalCount = data.totalCompanies;
      updateProgress();
      processSection.style.display = 'block';
      break;
      
    case 'search_progress':
      // 検索進捗の更新
      updateProcessDisplay(data.company, data.step, data.stepNumber);
      break;
      
    case 'search_complete':
      // 単一企業の検索完了
      if (data.success) {
        processedCount++;
        updateProgress();
      } else {
        // エラーが発生した場合の処理
        updateProcessDisplay(
          data.company,
          `エラー: ${data.error || '不明なエラー'}`,
          'error'
        );
      }
      break;
      
    case 'all_search_complete':
      // すべての検索が完了
      console.log(`検索完了: 成功=${data.successCount}, エラー=${data.errorCount}`);
      break;
      
    default:
      console.log('不明なWebSocketメッセージタイプ:', data.type);
  }
}

// イベントリスナーの登録
document.addEventListener('DOMContentLoaded', () => {
  // WebSocket接続を設定
  setupWebSocket();
  
  searchButton.addEventListener('click', handleSearch);
  clearButton.addEventListener('click', handleClear);
  exportCsvButton.addEventListener('click', handleExportCsv);
  copyTableButton.addEventListener('click', handleCopyTable);
  
  // 接続テストボタンを追加
  addConnectionTestButton();
});

// 接続テストボタンを追加
function addConnectionTestButton() {
  const button = document.createElement('button');
  button.className = 'connection-test-button';
  button.innerHTML = '<i class="fas fa-sync"></i> サーバー接続テスト';
  button.onclick = testServerConnection;
  
  const header = document.querySelector('header');
  header.appendChild(button);
}

// サーバー接続をテスト
async function testServerConnection() {
  try {
    updateConnectionStatus('テスト中...', 'reconnecting');
    
    // 1. HTTP APIをテスト
    const apiResponse = await fetch('/api/test');
    if (!apiResponse.ok) {
      throw new Error(`HTTP API テストに失敗: ${apiResponse.status}`);
    }
    const apiData = await apiResponse.json();
    console.log('HTTP API テスト成功:', apiData);
    
    // 2. WebSocketを再接続
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
      websocket.close();
    }
    setupWebSocket();
    
    // 接続成功メッセージを表示
    showAlert('サーバー接続テスト成功。WebSocketも再接続しました。');
    
  } catch (error) {
    console.error('サーバー接続テストに失敗:', error);
    updateConnectionStatus('接続失敗', 'error');
    showAlert(`サーバー接続テストに失敗: ${error.message}`);
  }
}

/**
 * 検索ボタンクリック時の処理
 */
async function handleSearch() {
  // WebSocket接続を確認
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    showAlert('サーバーとの接続が確立されていません。接続テストボタンをクリックしてください。');
    setupWebSocket(); // 再接続を試みる
    return;
  }
  
  const companyNames = companyInput.value.trim().split('\n')
    .map(name => name.trim())
    .filter(name => name !== '');
  
  // 入力チェック
  if (companyNames.length === 0) {
    showAlert('会社名を入力してください。');
    return;
  }
  
  // 入力上限チェック
  if (companyNames.length > 500) {
    showAlert('一度に検索できる会社数は500社までです。');
    return;
  }
  
  // 検索開始
  showLoadingModal('検索を開始しています...');
  clearResults();
  processSection.style.display = 'block';
  processContainer.innerHTML = '';
  
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ companies: companyNames })
    });
    
    if (!response.ok) {
      throw new Error(`サーバーエラー: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    hideLoadingModal();
    
    // 結果を表示
    searchResults = data.results;
    displayResults(searchResults);
    
  } catch (error) {
    hideLoadingModal();
    console.error('検索エラー:', error);
    showAlert(`検索中にエラーが発生しました: ${error.message}`);
  }
}

// クリアボタンクリック時の処理
function handleClear() {
  companyInput.value = '';
  clearResults();
  processSection.style.display = 'none';
}

// CSV出力ボタンクリック時の処理
async function handleExportCsv() {
  if (searchResults.length === 0) {
    showAlert('エクスポートする結果がありません。');
    return;
  }
  
  showLoadingModal('CSVファイルを生成しています...');
  
  try {
    const response = await fetch('/api/export-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ results: searchResults })
    });
    
    if (!response.ok) {
      throw new Error(`サーバーエラー: ${response.status}`);
    }
    
    // レスポンスのテキストを取得
    const csvData = await response.text();
    
    // CSVファイルとしてダウンロード
    const filename = `company_info_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(csvData, filename);
    
    hideLoadingModal();
    showAlert('CSVファイルがダウンロードされました。');
    
  } catch (error) {
    hideLoadingModal();
    console.error('CSVエクスポートエラー:', error);
    showAlert(`CSVエクスポート中にエラーが発生しました: ${error.message}`);
  }
}

// テーブルをコピーボタンクリック時の処理
function handleCopyTable() {
  if (searchResults.length === 0) {
    showAlert('コピーする結果がありません。');
    return;
  }
  
  // テーブルの内容をテキストとして構築
  let tableText = '会社名\t所在地\t代表者\t電話番号\t設立年\n';
  
  searchResults.forEach(result => {
    if (!result.errorOccurred) {
      tableText += `${result.companyName || ''}\t`;
      tableText += `${result.address || ''}\t`;
      tableText += `${result.representative || ''}\t`;
      tableText += `${result.phoneNumber || ''}\t`;
      tableText += `${result.foundingYear || ''}\n`;
    }
  });
  
  // クリップボードにコピー
  copyToClipboard(tableText);
  
  showAlert('検索結果がクリップボードにコピーされました。');
}

// 検索結果を表示
function displayResults(results) {
  resultsTbody.innerHTML = '';
  
  if (results.length === 0) {
    return;
  }
  
  // 成功した検索結果を先に表示
  const successResults = results.filter(result => !result.errorOccurred);
  const errorResults = results.filter(result => result.errorOccurred);
  
  // 成功結果を表示
  successResults.forEach(result => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td class="company-name">${escapeHtml(result.companyName || '')}</td>
      <td class="address">${escapeHtml(result.address || '')}</td>
      <td class="representative">${escapeHtml(result.representative || '')}</td>
      <td class="phone-number">${escapeHtml(result.phoneNumber || '')}</td>
      <td class="founding-year">${escapeHtml(result.foundingYear || '')}</td>
    `;
    
    resultsTbody.appendChild(row);
  });
  
  // エラー結果を表示（あれば）
  errorResults.forEach(result => {
    const row = document.createElement('tr');
    row.className = 'error-row';
    
    row.innerHTML = `
      <td class="company-name">${escapeHtml(result.companyName || '')}</td>
      <td colspan="4" class="error-message">エラー: ${escapeHtml(result.errorMessage || '不明なエラー')}</td>
    `;
    
    resultsTbody.appendChild(row);
  });
  
  // 結果セクションを表示
  resultsSection.style.display = 'block';
  exportCsvButton.style.display = 'inline-block';
  copyTableButton.style.display = 'inline-block';
}

// HTML特殊文字をエスケープ
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 処理状況の表示を更新
function updateProcessDisplay(companyName, step, stepNumber) {
  // すでに会社の処理状況要素があるかチェック
  let companyElement = document.getElementById(`process-${companyName}`);
  
  if (!companyElement) {
    // 新しい会社の処理状況要素を作成
    companyElement = document.createElement('div');
    companyElement.id = `process-${companyName}`;
    companyElement.className = 'process-item';
    
    const companyNameElement = document.createElement('div');
    companyNameElement.className = 'company-name';
    companyNameElement.textContent = companyName;
    
    const stepElement = document.createElement('div');
    stepElement.className = 'step-info';
    
    const progressElement = document.createElement('div');
    progressElement.className = 'progress-bar';
    
    companyElement.appendChild(companyNameElement);
    companyElement.appendChild(stepElement);
    companyElement.appendChild(progressElement);
    
    processContainer.appendChild(companyElement);
  }
  
  // 進捗状況を更新
  const stepElement = companyElement.querySelector('.step-info');
  stepElement.textContent = step;
  
  // エラーの場合
  if (stepNumber === 'error') {
    companyElement.classList.add('error');
    return;
  }
  
  // 進捗バーを更新
  const progressElement = companyElement.querySelector('.progress-bar');
  
  if (typeof stepNumber === 'number') {
    const progressPercent = Math.min(Math.floor((stepNumber / 5) * 100), 100);
    progressElement.style.width = `${progressPercent}%`;
    
    if (progressPercent === 100) {
      companyElement.classList.add('completed');
    }
  }
}

// 全体の進捗を更新
function updateProgress() {
  if (totalCount > 0) {
    const progressPercent = Math.floor((processedCount / totalCount) * 100);
    progressText.textContent = `進捗状況: ${processedCount}/${totalCount} (${progressPercent}%)`;
  }
}

// 結果をクリア
function clearResults() {
  searchResults = [];
  processedCount = 0;
  totalCount = 0;
  
  resultsTbody.innerHTML = '';
  resultsSection.style.display = 'none';
  exportCsvButton.style.display = 'none';
  copyTableButton.style.display = 'none';
}

// アラートメッセージを表示
function showAlert(message) {
  alert(message);
}

// ローディングモーダルを表示
function showLoadingModal(message = '処理中...') {
  loadingModal.style.display = 'flex';
  document.getElementById('loading-message').textContent = message;
}

// ローディングモーダルを非表示
function hideLoadingModal() {
  loadingModal.style.display = 'none';
}

/**
 * クリップボードにテキストをコピー
 */
function copyToClipboard(text) {
  // 一時的なテキストエリアを作成
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  
  // テキストを選択してコピー
  textArea.focus();
  textArea.select();
  
  try {
    // コピーコマンドを実行
    document.execCommand('copy');
  } catch (err) {
    console.error('クリップボードへのコピーに失敗しました', err);
  }
  
  // テキストエリアを削除
  document.body.removeChild(textArea);
}

/**
 * CSVファイルをダウンロード
 */
function downloadCsv(csv, filename) {
  // BOMを追加してExcelで文字化けしないようにする
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' });
  
  if (navigator.msSaveBlob) {
    // IEとEdgeの場合
    navigator.msSaveBlob(blob, filename);
  } else {
    // その他のブラウザの場合
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      // ダウンロード属性がサポートされている場合
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }
} 