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
let websocket;
let searchResults = [];
let processedCount = 0;
let totalCount = 0;
let reconnectAttempts = 0;
let isSearchInProgress = false; // 検索中フラグを追加
const MAX_RECONNECT_ATTEMPTS = 10;
let reconnectTimer = null;

// WebSocketを開始
function setupWebSocket() {
  try {
    console.log('[DEBUG] WebSocket接続を確立します...');
    
    // 新しい接続を作成 - 本番環境・ローカル環境どちらでも動作するように
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.host;
    const wsUrl = `${protocol}${host}/ws`;
    
    console.log(`[DEBUG] WebSocket URL: ${wsUrl}`);
    
    // 既存の接続を閉じる
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
      websocket.close();
    }
    
    // タイマーをクリア
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    websocket = new WebSocket(wsUrl);
    
    // 接続が開いたとき
    websocket.onopen = () => {
      console.log('[DEBUG] WebSocket接続が確立されました');
      updateConnectionStatus('接続済み', 'connected');
      reconnectAttempts = 0; // 再接続試行回数をリセット
      
      // クライアント情報を送信
      sendClientInfo();
      
      // 定期的なpingの送信を開始
      startPingInterval();
    };
    
    // メッセージを受信したとき
    websocket.onmessage = (event) => {
      try {
        console.log('[DEBUG] WebSocketメッセージを受信:', event.data.substring(0, 100) + '...');
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('[ERROR] WebSocketメッセージの解析エラー:', error);
      }
    };
    
    // エラーが発生したとき
    websocket.onerror = (error) => {
      console.error('[ERROR] WebSocketエラー:', error);
      updateConnectionStatus('接続エラー', 'error');
    };
    
    // 接続が閉じたとき
    websocket.onclose = (event) => {
      console.log(`[DEBUG] WebSocket接続が閉じられました (コード: ${event.code})`);
      
      // pingIntervalをクリア
      stopPingInterval();
      
      // 正常なクローズでなければ再接続を試みる
      if (event.code !== 1000 && event.code !== 1001) {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          
          // 指数バックオフ: 再試行の間隔を徐々に増やす
          const backoffTime = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
          console.log(`[DEBUG] ${backoffTime}ms後に再接続を試みます (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          updateConnectionStatus(`再接続中... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'reconnecting');
          
          reconnectTimer = setTimeout(setupWebSocket, backoffTime);
        } else {
          console.error('[ERROR] WebSocket再接続の試行回数が上限に達しました');
          updateConnectionStatus('接続失敗 - ページをリロードしてください', 'failed');
          
          // 自動リロードのオプションを表示
          showReconnectOption();
        }
      } else {
        updateConnectionStatus('切断済み', 'disconnected');
      }
    };
  } catch (error) {
    console.error('[ERROR] WebSocket接続の初期化に失敗:', error);
    updateConnectionStatus('接続失敗', 'failed');
  }
  
  return websocket;
}

// 自動リロードオプションの表示
function showReconnectOption() {
  const reconnectOption = document.createElement('div');
  reconnectOption.className = 'reconnect-option';
  reconnectOption.innerHTML = `
    <p>サーバーとの接続が切断されました。</p>
    <button id="reload-button">ページをリロード</button>
    <button id="retry-button">再接続を試みる</button>
  `;
  
  document.body.appendChild(reconnectOption);
  
  document.getElementById('reload-button').addEventListener('click', () => {
    window.location.reload();
  });
  
  document.getElementById('retry-button').addEventListener('click', () => {
    document.body.removeChild(reconnectOption);
    reconnectAttempts = 0;
    setupWebSocket();
  });
}

// 接続状態の表示を更新
function updateConnectionStatus(message, status) {
  // すでに接続ステータス要素があれば更新、なければ作成
  let statusElement = document.querySelector('.connection-indicator');
  
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.className = 'connection-indicator';
    
    // ステータスドットとテキスト要素を作成
    const statusDot = document.createElement('span');
    statusDot.className = 'connection-status';
    
    const statusText = document.createElement('span');
    statusText.className = 'connection-text';
    
    statusElement.appendChild(statusDot);
    statusElement.appendChild(statusText);
    
    // 検索セクションの先頭に挿入
    const searchSection = document.getElementById('search-section');
    searchSection.insertBefore(statusElement, searchSection.firstChild);
  }
  
  // クラスを更新
  const statusDot = statusElement.querySelector('.connection-status');
  const statusText = statusElement.querySelector('.connection-text');
  
  // クラスをリセット
  statusDot.className = 'connection-status';
  statusDot.classList.add(`status-${status}`);
  statusText.textContent = message;
  
  // デバッグ情報も更新
  updateDebugInfo(message, status);
}

// デバッグ情報を更新
function updateDebugInfo(message, status) {
  const debugElement = document.getElementById('connection-status-debug');
  if (debugElement) {
    const timestamp = new Date().toLocaleTimeString();
    let color = 'black';
    
    switch (status) {
      case 'connected': color = 'green'; break;
      case 'disconnected': color = 'red'; break;
      case 'reconnecting': color = 'orange'; break;
      case 'error': case 'failed': color = 'red'; break;
    }
    
    debugElement.innerHTML += `
      <div style="color: ${color}">
        [${timestamp}] ${message}
      </div>
    `;
    
    // 自動スクロール
    debugElement.scrollTop = debugElement.scrollHeight;
  }
}

// WebSocketメッセージを処理
function handleWebSocketMessage(data) {
  if (!data || !data.type) {
    console.error('[ERROR] 無効なWebSocketメッセージ:', data);
    return;
  }
  
  console.log(`[DEBUG] メッセージタイプ: ${data.type}`);
  
  switch (data.type) {
    case 'search_start':
      // 検索開始の通知
      console.log('[DEBUG] 検索開始:', data);
      
      // 検索状態のリセット
      processedCount = 0;
      totalCount = data.totalCompanies;
      updateProgress();
      processSection.style.display = 'block';
      
      // プロセスコンテナをクリア
      processContainer.innerHTML = '';
      
      // 結果をクリア
      clearResults();
      
      // ローディングモーダルを表示
      showLoadingModal('検索中です。しばらくお待ちください...');
      break;
    
    case 'search_progress':
      // 検索進捗の更新
      console.log('[DEBUG] 検索進捗:', data);
      updateProcessDisplay(data.company, data.step, data.stepNumber);
      break;
    
    case 'search_complete':
      // 単一企業の検索完了
      console.log('[DEBUG] 検索完了:', data);
      
      if (data.success) {
        processedCount++;
        updateProcessDisplay(data.company, '検索完了', 'success');
      } else {
        // エラーが発生した場合の処理
        updateProcessDisplay(
          data.company,
          `エラー: ${data.error || '不明なエラー'}`,
          'error'
        );
        
        // エラーメッセージを表示
        showErrorNotification('検索エラー', `${data.company}: ${data.error}`);
      }
      
      updateProgress();
      break;
    
    case 'all_search_complete':
      // すべての検索が完了
      console.log(`[DEBUG] すべての検索完了: 成功=${data.successCount}, エラー=${data.errorCount}`);
      
      // 検索中フラグをリセット
      isSearchInProgress = false;
      
      // ローディングモーダルを非表示
      hideLoadingModal();
      
      // サーバーから結果データを受け取る
      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        console.log('[DEBUG] 検索結果を受信:', data.results);
        searchResults = data.results; // 結果を保存
        displayResults(data.results);
      } else {
        console.log('[DEBUG] all_search_completeに結果データがないためAPIから取得します');
        
        // 成功件数がある場合はAPIで結果を取得
        if (data.successCount > 0) {
          // APIから結果を取得
          fetchSearchResults();
        } else {
          // 検索結果がなければメッセージを表示
          showAlert('検索結果が見つかりませんでした。検索条件を変えてお試しください。');
        }
      }
      break;
    
    case 'search_results':
      // 検索結果データを受信
      console.log('[DEBUG] 検索結果データを受信:', data.results);
      if (data.results && Array.isArray(data.results)) {
        searchResults = data.results; // 結果を保存
        displayResults(data.results);
      }
      break;
    
    case 'pong':
      // サーバーからのpongレスポンス
      console.log('[DEBUG] サーバーからpongを受信しました');
      break;
    
    case 'error':
      // エラーメッセージの処理
      console.error('[ERROR] サーバーからエラーを受信:', data.message);
      showErrorNotification('検索エラー', data.message);
      hideLoadingModal();
      isSearchInProgress = false;
      break;
    
    default:
      console.log(`[DEBUG] 不明なメッセージタイプ: ${data.type}`, data);
  }
}

// 検索結果を取得
async function fetchSearchResults() {
  try {
    console.log('[DEBUG] APIから検索結果を取得します');
    const response = await fetch('/api/search-results');
    
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'ok' && data.results && Array.isArray(data.results) && data.results.length > 0) {
        console.log('[DEBUG] 検索結果を取得しました:', data.results);
        searchResults = data.results; // 結果を保存
        displayResults(data.results);
      } else {
        console.error('[ERROR] 検索結果の形式が不正または空です:', data);
        if (Array.isArray(data.results) && data.results.length === 0) {
          showAlert('検索結果が見つかりませんでした。検索条件を変えてお試しください。');
        } else {
          showErrorNotification('データエラー', '検索結果の取得に失敗しました。');
        }
      }
    } else {
      console.error('[ERROR] 検索結果の取得に失敗しました:', response.status);
      showErrorNotification('APIエラー', '検索結果の取得に失敗しました。');
    }
  } catch (error) {
    console.error('[ERROR] 検索結果の取得中にエラーが発生しました:', error);
    showErrorNotification('通信エラー', '検索結果の取得中にエラーが発生しました。');
  }
}

// エラー通知を表示
function showErrorNotification(title, message) {
  console.error(`[ERROR] ${title}: ${message}`);
  
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.innerHTML = `
    <div class="error-title">${title}</div>
    <div class="error-message">${message}</div>
    <button class="error-close">閉じる</button>
  `;
  
  document.body.appendChild(notification);
  
  // トランジション効果のために少し遅らせる
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  notification.querySelector('.error-close').addEventListener('click', () => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  });
  
  // 8秒後に自動的に閉じる
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.classList.remove('show');
      setTimeout(() => {
        if (document.body.contains(notification)) {
          notification.remove();
        }
      }, 300);
    }
  }, 8000);
}

// 検索処理
function handleSearch(event) {
  if (event) {
    event.preventDefault(); // フォーム送信のデフォルト動作を停止
  }
  
  // すでに検索中の場合は何もしない
  if (isSearchInProgress) {
    console.log('[DEBUG] 既に検索中です。重複リクエストを無視します。');
    showAlert('すでに検索処理が実行中です。完了までお待ちください。');
    return;
  }
  
  try {
    console.log('[DEBUG] 検索を開始します...');
    
    // テキスト入力から会社名のリストを取得（空行などを除去）
    const companyInput = document.getElementById('company-input');
    const inputText = companyInput.value.trim();
    
    if (!inputText) {
      showAlert('会社名を入力してください。');
      return;
    }
    
    // 改行で区切って配列に変換し、空白行を除去
    const companyList = inputText.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // 入力がない場合
    if (companyList.length === 0) {
      showAlert('会社名を入力してください。');
      return;
    }
    
    // 1文字だけの会社名をフィルタリング（エラー防止）
    const validCompanyList = companyList.filter(company => {
      if (company.length < 2) {
        console.warn(`[WARNING] "${company}"は1文字のため検索から除外されました。`);
        return false;
      }
      return true;
    });
    
    if (validCompanyList.length === 0) {
      showAlert('有効な会社名がありません。会社名は2文字以上で入力してください。');
      return;
    }
    
    console.log(`[DEBUG] 検索対象会社（${validCompanyList.length}社）:`, validCompanyList);
    
    // 検索中フラグを設定
    isSearchInProgress = true;
    
    // 検索セクションの表示を制御
    processSection.style.display = 'block';
    resultsSection.style.display = 'none';
    
    // メッセージの作成
    const message = {
      type: 'search',
      companies: validCompanyList
    };
    
    // WebSocketの状態を確認
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      // WebSocketを通じて検索リクエストを送信
      console.log('[DEBUG] WebSocketを通じて検索リクエストを送信します:', message);
      websocket.send(JSON.stringify(message));
      
      // スクロール位置を先頭に移動
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      console.error('[ERROR] WebSocket接続が確立されていません');
      showErrorNotification('接続エラー', 'サーバーへの接続が確立されていません。ページを再読み込みするか、しばらく待ってから再試行してください。');
      
      // 検索中フラグをリセット
      isSearchInProgress = false;
      
      // WebSocketを再接続
      setupWebSocket();
    }
  } catch (error) {
    console.error('[ERROR] 検索リクエストの送信中にエラーが発生しました:', error);
    showErrorNotification('検索エラー', 'リクエスト送信中にエラーが発生しました: ' + error.message);
    
    // 検索中フラグをリセット
    isSearchInProgress = false;
  }
}

// クリアボタンのハンドラ
function handleClear() {
  companyInput.value = '';
  clearResults();
  processSection.style.display = 'none';
  resultsSection.style.display = 'none';
}

// CSVエクスポートハンドラ
async function handleExportCsv() {
  try {
    if (searchResults.length === 0) {
      showAlert('エクスポートできる検索結果がありません。');
      return;
    }
    
    showLoadingModal('CSVファイルを準備中...');
    
    // APIエンドポイントにPOSTリクエストを送信
    const response = await fetch('/api/export-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        results: searchResults
      })
    });
    
    if (response.ok) {
      // レスポンスからblobを取得
      const blob = await response.blob();
      // blobからURLを作成
      const url = window.URL.createObjectURL(blob);
      // リンク要素を作成
      const a = document.createElement('a');
      a.href = url;
      a.download = 'company_info.csv';
      // リンクをクリック（ダウンロード開始）
      a.click();
      // URLを解放
      window.URL.revokeObjectURL(url);
      
      showAlert('CSVファイルがダウンロードされました。');
    } else {
      const error = await response.json();
      console.error('[ERROR] CSVエクスポートに失敗しました:', error);
      showAlert(`CSVエクスポートに失敗しました: ${error.error || '不明なエラー'}`);
    }
  } catch (error) {
    console.error('[ERROR] CSVエクスポート中にエラーが発生しました:', error);
    showAlert('CSVエクスポート中にエラーが発生しました。');
  } finally {
    hideLoadingModal();
  }
}

// テーブルコピーハンドラ
function handleCopyTable() {
  try {
    if (searchResults.length === 0) {
      showAlert('コピーできる検索結果がありません。');
      return;
    }
    
    // ヘッダー行
    const headers = ['会社名', '郵便番号', '都道府県', '市区町村', '残りの住所', '代表者役職', '代表者名'];
    
    // データ行の構築
    const rows = searchResults.map(item => {
      return [
        item.companyName || '',
        item.postalCode || '',
        item.prefecture || '',
        item.city || '',
        item.address || '',
        item.representativeTitle || '',
        item.representativeName || ''
      ];
    });
    
    // タブ区切りのテキストに変換
    const table = [headers, ...rows].map(row => row.join('\t')).join('\n');
    
    // クリップボードにコピー
    copyToClipboard(table);
    
    showAlert('検索結果がクリップボードにコピーされました。');
  } catch (error) {
    console.error('[ERROR] テーブルのコピー中にエラーが発生しました:', error);
    showAlert('テーブルのコピー中にエラーが発生しました。');
  }
}

// クリップボードにコピー
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .catch(error => {
        console.error('[ERROR] クリップボードへのコピーに失敗しました:', error);
        fallbackCopyToClipboard(text);
      });
  } else {
    fallbackCopyToClipboard(text);
  }
}

// フォールバックのコピー方法
function fallbackCopyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    document.execCommand('copy');
    console.log('[DEBUG] execCommandを使用してコピーしました');
  } catch (error) {
    console.error('[ERROR] コピーに失敗しました:', error);
  }
  
  document.body.removeChild(textarea);
}

// 検索結果を表示
function displayResults(results) {
  console.log('[DEBUG] displayResults呼び出し:', results);
  
  // 結果を保存
  if (results && Array.isArray(results)) {
    searchResults = results;
  }
  
  if (!searchResults || searchResults.length === 0) {
    console.log('[DEBUG] 表示する結果がありません');
    resultsSection.style.display = 'none';
    return;
  }
  
  // テーブル本体をクリア
  resultsTbody.innerHTML = '';
  
  let hasDisplayedResults = false;
  
  // 結果をテーブルに追加
  searchResults.forEach(item => {
    if (!item || typeof item !== 'object') {
      console.error('[ERROR] 無効な検索結果項目:', item);
      return;
    }
    
    hasDisplayedResults = true;
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td>${escapeHtml(item.companyName || '')}</td>
      <td>${escapeHtml(item.postalCode || '')}</td>
      <td>${escapeHtml(item.prefecture || '')}</td>
      <td>${escapeHtml(item.city || '')}</td>
      <td>${escapeHtml(item.address || '')}</td>
      <td>${escapeHtml(item.representativeTitle || '')}</td>
      <td>${escapeHtml(item.representativeName || '')}</td>
    `;
    
    resultsTbody.appendChild(row);
  });
  
  if (hasDisplayedResults) {
    // 結果セクションを表示
    resultsSection.style.display = 'block';
    console.log('[DEBUG] 検索結果を表示しました:', searchResults.length, '件');
  } else {
    resultsSection.style.display = 'none';
    console.log('[DEBUG] 有効な検索結果がありませんでした');
  }
}

// HTMLエスケープ
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
  // 会社名に対応する要素がすでに存在するか確認
  let processItem = document.querySelector(`.process-step[data-company="${companyName}"]`);
  
  // 新しい会社の場合は要素を作成
  if (!processItem) {
    processItem = document.createElement('div');
    processItem.className = 'process-step';
    processItem.dataset.company = companyName;
    
    // ステップインジケーター
    const stepIndicator = document.createElement('div');
    stepIndicator.className = 'step-indicator';
    
    // コンテンツエリア
    const content = document.createElement('div');
    content.className = 'step-content';
    
    // 会社名
    const companyNameElement = document.createElement('div');
    companyNameElement.className = 'step-company';
    companyNameElement.textContent = companyName;
    content.appendChild(companyNameElement);
    
    // ステップの説明
    const description = document.createElement('div');
    description.className = 'step-description';
    content.appendChild(description);
    
    // プログレスバー
    const progress = document.createElement('div');
    progress.className = 'step-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'step-progress-bar';
    progress.appendChild(progressBar);
    content.appendChild(progress);
    
    // 要素を追加
    processItem.appendChild(stepIndicator);
    processItem.appendChild(content);
    processContainer.appendChild(processItem);
  }
  
  // ステップの状態によってスタイルを更新
  const stepIndicator = processItem.querySelector('.step-indicator');
  const description = processItem.querySelector('.step-description');
  const progressBar = processItem.querySelector('.step-progress-bar');
  
  // すべてのステータスクラスを削除
  processItem.classList.remove('active', 'success', 'error', 'waiting');
  stepIndicator.classList.remove('active', 'success', 'error', 'waiting');
  
  // ステップ番号の処理
  if (stepNumber === 'success') {
    stepIndicator.innerHTML = '<i class="fas fa-check"></i>';
    stepIndicator.classList.add('success');
    processItem.classList.add('success');
    progressBar.style.width = '100%';
  } else if (stepNumber === 'error') {
    stepIndicator.innerHTML = '<i class="fas fa-times"></i>';
    stepIndicator.classList.add('error');
    processItem.classList.add('error');
    progressBar.style.width = '100%';
  } else if (typeof stepNumber === 'number') {
    stepIndicator.textContent = stepNumber;
    stepIndicator.classList.add('active');
    processItem.classList.add('active');
    
    // 進捗バーの更新（5ステップと仮定）
    const progressPercentage = Math.min(100, (stepNumber / 5) * 100);
    progressBar.style.width = `${progressPercentage}%`;
  } else {
    stepIndicator.textContent = '?';
    stepIndicator.classList.add('waiting');
    processItem.classList.add('waiting');
  }
  
  // 説明テキストを更新
  description.textContent = step;
  
  // プロセスセクションが非表示の場合は表示
  if (processSection.style.display === 'none') {
    processSection.style.display = 'block';
  }
}

// 進捗表示を更新
function updateProgress() {
  progressText.textContent = `${processedCount} / ${totalCount} 完了`;
}

// 結果のクリア
function clearResults() {
  searchResults = [];
  resultsTbody.innerHTML = '';
}

// アラート表示
function showAlert(message) {
  alert(message);
}

// ローディングモーダルの表示
function showLoadingModal(message = '処理中...') {
  document.getElementById('loading-message').textContent = message;
  loadingModal.style.display = 'flex';
}

// ローディングモーダルの非表示
function hideLoadingModal() {
  loadingModal.style.display = 'none';
}

// クライアント情報の送信
function sendClientInfo() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    const clientInfo = {
      type: 'client_info',
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    };
    
    websocket.send(JSON.stringify(clientInfo));
  }
}

// pingの送信を開始
let pingInterval = null;

function startPingInterval() {
  // 古いインターバルをクリア
  stopPingInterval();
  
  // 15秒ごとにpingを送信
  pingInterval = setInterval(() => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      try {
        websocket.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error('[ERROR] ping送信エラー:', error);
      }
    }
  }, 15000);
}

function stopPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// 初期化処理
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] DOM読み込み完了');
  
  // WebSocket接続を確立
  websocket = setupWebSocket();
  
  // 初期UIの設定
  setupInitialUI();
  
  // 検索フォームのイベントリスナー - 明示的に1回だけ追加
  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    searchForm.removeEventListener('submit', handleSearch); // 既存のハンドラを削除
    searchForm.addEventListener('submit', handleSearch);
    console.log('[DEBUG] 検索フォームにイベントリスナーを設定しました');
  } else {
    console.error('[ERROR] 検索フォーム要素が見つかりません');
  }
  
  // 検索ボタンのイベントリスナー - 直接フォーム送信を処理
  if (searchButton) {
    searchButton.removeEventListener('click', handleSearchButton); // 既存のハンドラを削除
    searchButton.addEventListener('click', handleSearchButton);
    console.log('[DEBUG] 検索ボタンにイベントリスナーを設定しました');
  } else {
    console.error('[ERROR] 検索ボタン要素が見つかりません');
  }
  
  // クリアボタンのイベントリスナー
  if (clearButton) {
    clearButton.addEventListener('click', handleClear);
  }
  
  // エクスポートボタンのイベントリスナー
  if (exportCsvButton) {
    exportCsvButton.addEventListener('click', handleExportCsv);
  }
  
  if (copyTableButton) {
    copyTableButton.addEventListener('click', handleCopyTable);
  }
  
  // デバッグモードの有効化 (開発用)
  const debugSection = document.getElementById('connection-debug');
  if (debugSection) {
    debugSection.style.display = 'block';
  }
  
  // テストメッセージ送信ボタン
  const debugSendTestButton = document.getElementById('debug-send-test');
  if (debugSendTestButton) {
    debugSendTestButton.addEventListener('click', () => {
      console.log('[DEBUG] テストメッセージ送信ボタンがクリックされました');
      
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        try {
          const testMsg = {
            type: 'test_message',
            timestamp: Date.now(),
            content: 'これはテストメッセージです'
          };
          console.log('[DEBUG] テストメッセージを送信します:', testMsg);
          websocket.send(JSON.stringify(testMsg));
          
          document.getElementById('connection-status-debug').innerHTML += 
            '<div style="color: green;">テストメッセージを送信しました</div>';
        } catch (e) {
          console.error('[ERROR] テストメッセージ送信エラー:', e);
          document.getElementById('connection-status-debug').innerHTML += 
            '<div style="color: red;">テストメッセージ送信エラー: ' + e.message + '</div>';
        }
      } else {
        console.error('[ERROR] WebSocketが接続されていません');
        document.getElementById('connection-status-debug').innerHTML += 
          '<div style="color: red;">WebSocketが接続されていません。状態: ' + 
          (websocket ? websocket.readyState : 'undefined') + '</div>';
      }
    });
  }
  
  // 手動接続ボタン (デバッグ用)
  const debugReconnectButton = document.getElementById('debug-reconnect');
  if (debugReconnectButton) {
    debugReconnectButton.addEventListener('click', () => {
      console.log('[DEBUG] 手動再接続ボタンがクリックされました');
      reconnectAttempts = 0;
      setupWebSocket();
      
      document.getElementById('connection-status-debug').innerHTML += 
        '<div style="color: blue;">手動で再接続を試みています...</div>';
    });
  }
  
  // 初期状態でプロセスセクションと結果セクションを非表示
  if (processSection) processSection.style.display = 'none';
  if (resultsSection) resultsSection.style.display = 'none';
  
  console.log('[DEBUG] 初期化完了');
});

// 検索ボタンクリックハンドラ
function handleSearchButton(event) {
  event.preventDefault();
  console.log('[DEBUG] 検索ボタンがクリックされました');
  handleSearch();
}

// 初期UIのセットアップ
function setupInitialUI() {
  // 接続状態表示の作成
  updateConnectionStatus('接続待機中...', 'waiting');
  
  // テキストエリアのプレースホルダーテキストを設定
  if (companyInput) {
    companyInput.placeholder = '例： \n株式会社テクノフューチャー\nグローバルイノベーション株式会社\n未来創造産業';
  }
  
  // 既存の表示をクリア
  if (processSection) processSection.style.display = 'none';
  if (resultsSection) resultsSection.style.display = 'none';
  
  // デバッグ情報セクションを追加
  const debugSection = document.getElementById('connection-debug');
  if (debugSection) {
    // 再接続ボタンを追加
    if (!document.getElementById('debug-reconnect')) {
      const reconnectButton = document.createElement('button');
      reconnectButton.id = 'debug-reconnect';
      reconnectButton.textContent = '接続再試行';
      reconnectButton.className = 'debug-button';
      debugSection.appendChild(reconnectButton);
    }
  }
} 