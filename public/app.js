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
  
  // 新しい接続を作成 - ポート3001を使用
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.hostname}:3001`;
  
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
  
  if (companyNames.length > 500) {
    showAlert('最大500社までしか一度に検索できません。');
    return;
  }
  
  // 検索開始
  processedCount = 0;
  totalCount = companyNames.length;
  searchResults = [];
  
  // UI更新
  clearResults();
  updateProgress();
  showLoadingModal();
  
  // 検索プロセスの表示を初期化
  processContainer.innerHTML = '';
  processSection.style.display = 'block';
  
  try {
    // APIリクエスト
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ companies: companyNames })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || '検索中にエラーが発生しました。');
    }
    
    const data = await response.json();
    
    // 検索結果データを検証
    if (!data || !data.results || !Array.isArray(data.results)) {
      throw new Error('サーバーから正しい形式のデータが返されませんでした。');
    }
    
    // エラーチェック
    const hasErrors = data.results.some(result => result.errorOccurred);
    if (hasErrors) {
      const errorMessages = data.results
        .filter(result => result.errorOccurred)
        .map(result => `${result.companyName}: ${result.error}`)
        .join('\n');
      
      showAlert(`一部の会社で検索エラーが発生しました:\n${errorMessages}`);
    }
    
    // エラーがないデータのみをフィルタリング
    searchResults = data.results.filter(result => !result.errorOccurred);
    
    // 有効な結果がない場合
    if (searchResults.length === 0) {
      showAlert('検索結果がありませんでした。検索語を変更するか、後でもう一度お試しください。');
      hideLoadingModal();
      return;
    }
    
    // 結果の表示
    displayResults(searchResults);
    
  } catch (error) {
    showAlert(`エラー: ${error.message}`);
    console.error('Search error:', error);
  } finally {
    hideLoadingModal();
  }
}

/**
 * クリアボタンクリック時の処理
 */
function handleClear() {
  companyInput.value = '';
  clearResults();
  processSection.style.display = 'none';
  resultsSection.style.display = 'none';
}

/**
 * CSVエクスポートボタンクリック時の処理
 */
async function handleExportCsv() {
  if (searchResults.length === 0) {
    showAlert('エクスポートする結果がありません。');
    return;
  }
  
  try {
    showLoadingModal();
    
    const response = await fetch('/api/export-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ results: searchResults })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'CSVエクスポート中にエラーが発生しました。');
    }
    
    // CSVデータを取得
    const csvData = await response.text();
    
    // CSVファイルとしてダウンロード
    downloadCsv(csvData, 'company_info.csv');
    
  } catch (error) {
    showAlert(`エラー: ${error.message}`);
    console.error('CSV export error:', error);
  } finally {
    hideLoadingModal();
  }
}

/**
 * テーブルコピーボタンクリック時の処理
 */
function handleCopyTable() {
  if (searchResults.length === 0) {
    showAlert('コピーする結果がありません。');
    return;
  }
  
  // テーブルをクリップボードにコピー
  const tableHeaders = [
    '会社名', '郵便番号', '都道府県', '市区町村', '残りの住所', '代表者の役職名', '代表者名'
  ];
  
  let tableText = tableHeaders.join('\t') + '\n';
  
  searchResults.forEach(result => {
    const row = [
      result.companyName || '',
      result.postalCode || '',
      result.prefecture || '',
      result.city || '',
      result.address || '',
      result.representativeTitle || '',
      result.representativeName || ''
    ];
    tableText += row.join('\t') + '\n';
  });
  
  copyToClipboard(tableText);
  showAlert('テーブルがクリップボードにコピーされました。');
}

/**
 * 検索結果の表示
 * @param {Array} results - 検索結果の配列
 */
function displayResults(results) {
  if (results.length === 0) {
    resultsSection.style.display = 'none';
    return;
  }
  
  // テーブルの内容をクリア
  resultsTbody.innerHTML = '';
  
  // 各結果を表示
  results.forEach(result => {
    // エラーがあるデータはスキップ
    if (result.errorOccurred || result.error) {
      return;
    }
    
    const tr = document.createElement('tr');
    
    // 各セルの追加
    const cells = [
      result.companyName || '',
      result.postalCode || '',
      result.prefecture || '',
      result.city || '',
      result.address || '',
      result.representativeTitle || '',
      result.representativeName || ''
    ];
    
    cells.forEach(cellText => {
      const td = document.createElement('td');
      td.textContent = cellText;
      tr.appendChild(td);
    });
    
    resultsTbody.appendChild(tr);
  });
  
  // 結果が1つ以上あるか確認
  if (resultsTbody.children.length === 0) {
    showAlert('表示できる結果がありません。');
    resultsSection.style.display = 'none';
    return;
  }
  
  // 結果セクションを表示
  resultsSection.style.display = 'block';
  
  // アニメーション効果
  resultsSection.classList.add('fade-in');
  setTimeout(() => {
    resultsSection.classList.remove('fade-in');
  }, 500);
}

/**
 * 検索プロセスの表示を更新
 * @param {string} companyName - 会社名
 * @param {string} step - 検索ステップの説明
 * @param {number|string} stepNumber - ステップ番号またはエラー
 */
function updateProcessDisplay(companyName, step, stepNumber) {
  // 会社ごとのプロセスアイテムを取得または作成
  let processItem = document.querySelector(`.process-item[data-company="${companyName}"]`);
  
  if (!processItem) {
    processItem = document.createElement('div');
    processItem.className = 'process-item';
    processItem.setAttribute('data-company', companyName);
    
    const companyHeader = document.createElement('div');
    companyHeader.className = 'process-company';
    companyHeader.textContent = companyName;
    processItem.appendChild(companyHeader);
    
    processContainer.appendChild(processItem);
  }
  
  // ステップを追加
  const processStep = document.createElement('div');
  processStep.className = 'process-step';
  
  const stepIcon = document.createElement('div');
  stepIcon.className = 'process-step-icon';
  
  // エラーの場合は特別なスタイルを適用
  if (stepNumber === 'error') {
    stepIcon.classList.add('error');
    stepIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
  } else {
    stepIcon.textContent = stepNumber;
  }
  
  const stepText = document.createElement('div');
  stepText.className = 'process-step-text';
  if (stepNumber === 'error') {
    stepText.classList.add('error');
  }
  stepText.textContent = step;
  
  processStep.appendChild(stepIcon);
  processStep.appendChild(stepText);
  processItem.appendChild(processStep);
  
  // スクロールを最下部に移動
  processContainer.scrollTop = processContainer.scrollHeight;
}

/**
 * 進捗表示の更新
 */
function updateProgress() {
  progressText.textContent = `${processedCount} / ${totalCount} 完了`;
}

/**
 * 結果をクリア
 */
function clearResults() {
  resultsTbody.innerHTML = '';
  processContainer.innerHTML = '';
  searchResults = [];
}

/**
 * アラートを表示
 * @param {string} message - 表示するメッセージ
 */
function showAlert(message) {
  alert(message);
}

/**
 * ローディングモーダルを表示
 */
function showLoadingModal() {
  loadingModal.classList.add('active');
}

/**
 * ローディングモーダルを非表示
 */
function hideLoadingModal() {
  loadingModal.classList.remove('active');
}

/**
 * テキストをクリップボードにコピー
 * @param {string} text - コピーするテキスト
 */
function copyToClipboard(text) {
  // 一時的なテキストエリアを作成
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  
  // テキストを選択してコピー
  textarea.select();
  document.execCommand('copy');
  
  // テキストエリアを削除
  document.body.removeChild(textarea);
}

/**
 * CSVファイルをダウンロード
 * @param {string} csv - CSVデータ
 * @param {string} filename - ファイル名
 */
function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
} 