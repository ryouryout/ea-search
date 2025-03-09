const axios = require('axios');
const dotenv = require('dotenv');
const https = require('https');

// Load environment variables
dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;

// Railway環境かどうかを検出
const IS_RAILWAY = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL;

// Railway環境でのaxios設定カスタマイズ
if (IS_RAILWAY) {
  console.log('Railway環境用のaxios設定を適用します');
  
  // デフォルトのHTTPSエージェント設定
  const httpsAgent = new https.Agent({
    keepAlive: true,
    timeout: 60000, // 60秒
    rejectUnauthorized: true // SSL証明書の検証を有効に
  });
  
  // axiosのデフォルト設定
  axios.defaults.timeout = 30000; // 30秒
  axios.defaults.httpsAgent = httpsAgent;
  axios.defaults.maxRedirects = 5;
  axios.defaults.maxContentLength = 50 * 1024 * 1024; // 50MB
  
  // リクエストインターセプター
  axios.interceptors.request.use(config => {
    console.log(`API呼び出し: ${config.url}`);
    return config;
  }, error => {
    console.error('リクエスト設定エラー:', error.message);
    return Promise.reject(error);
  });
  
  // レスポンスインターセプター
  axios.interceptors.response.use(response => {
    console.log(`ステータスコード: ${response.status} (${response.config.url})`);
    return response;
  }, error => {
    console.error(`API呼び出しエラー: ${error.message}`);
    return Promise.reject(error);
  });
}

// 環境変数のログ出力（機密情報を隠して）
console.log('環境変数の確認:');
console.log('- GOOGLE_SEARCH_API_KEY:', GOOGLE_API_KEY ? `設定済み (${GOOGLE_API_KEY.substring(0, 5)}...)` : '未設定');
console.log('- GOOGLE_SEARCH_ENGINE_ID:', GOOGLE_SEARCH_ENGINE_ID || '未設定');
console.log('- ANTHROPIC_API_KEY:', CLAUDE_API_KEY ? `設定済み (${CLAUDE_API_KEY.substring(0, 5)}...)` : '未設定');

// Railway環境であるかの確認（デバッグ用）
console.log('- 実行環境:', IS_RAILWAY ? 'Railway' : 'ローカル');
console.log('- NODE_ENV:', process.env.NODE_ENV || '未設定');

/**
 * 会社情報を検索する
 * @param {string} companyName - 検索する会社名
 * @param {function} progressCallback - 進捗通知用コールバック関数（オプション）
 * @returns {Promise<Object>} - 会社情報オブジェクト
 */
async function searchCompanyInfo(companyName, progressCallback) {
  try {
    console.log(`Searching for company: ${companyName}`);
    
    // 進捗を通知
    if (progressCallback) {
      progressCallback('基本情報を検索中...', 1);
    } else {
      console.log(`Search progress: ${companyName} - 基本情報を検索中... (1)`);
    }
    
    // 会社情報を検索
    const companyInfo = await getCompanyInfo(companyName, progressCallback);
    
    return companyInfo;
  } catch (error) {
    console.error(`Error searching for ${companyName}:`, error);
    throw error;
  }
}

/**
 * Google検索とClaudeを使用して会社情報を取得
 * @param {string} companyName - 検索する会社名
 * @param {function} progressCallback - 進捗通知用コールバック関数（オプション）
 * @returns {Promise<Object>} - 会社情報オブジェクト
 */
async function getCompanyInfo(companyName, progressCallback) {
  // 基本情報を検索
  const searchQuery = `${companyName} 会社概要 本社 住所 代表`;
  
  // GoogleカスタムAPI検索を実行
  const searchResults = await googleSearch(searchQuery);
  
  // 進捗を通知
  if (progressCallback) {
    progressCallback('情報を抽出中...', 2);
  } else {
    console.log(`Search progress: ${companyName} - 情報を抽出中... (2)`);
  }
  
  // ClaudeAPIを使って情報を抽出
  const extractedInfo = await extractInfoWithClaude(companyName, searchResults);
  
  // 追加情報の検索
  let additionalSearchQuery = null;
  
  if (extractedInfo.postalCode) {
    additionalSearchQuery = `${companyName} 郵便番号 ${extractedInfo.postalCode}`;
  } else if (extractedInfo.prefecture && extractedInfo.city) {
    additionalSearchQuery = `${companyName} ${extractedInfo.prefecture} ${extractedInfo.city} 本社所在地`;
  } else {
    additionalSearchQuery = `${companyName} 代表取締役`;
  }
  
  // 進捗を通知
  if (progressCallback) {
    progressCallback('追加情報を検索中...', 3);
  } else {
    console.log(`Search progress: ${companyName} - 追加情報を検索中... (3)`);
  }
  
  // 生成したクエリをログに出力
  console.log(`生成された追加検索クエリ: "${additionalSearchQuery}"`);
  
  // 追加検索を実行
  const additionalSearchResults = await googleSearch(additionalSearchQuery);
  
  // 進捗を通知
  if (progressCallback) {
    progressCallback('情報を検証中...', 4);
  } else {
    console.log(`Search progress: ${companyName} - 情報を検証中... (4)`);
  }
  
  // Claudeで情報の検証と充実化
  const validatedInfo = await validateInfoWithClaude(companyName, additionalSearchResults, extractedInfo);
  
  // 進捗を通知
  if (progressCallback) {
    progressCallback('検索完了', 5);
  } else {
    console.log(`Search progress: ${companyName} - 検索完了 (5)`);
  }
  
  return validatedInfo;
}

/**
 * Railway環境向けのフォールバック検索機能
 * Google検索が失敗した場合に使用されるバックアップメカニズム
 */
async function railwayFallbackSearch(query) {
  console.log(`Railway向けフォールバック検索実行: "${query}"`);
  
  try {
    // クエリを簡素化して再試行
    const simplifiedQuery = query.replace(/[^\w\s]/gi, '').trim().substring(0, 100);
    console.log(`簡素化クエリ: "${simplifiedQuery}"`);
    
    // バックアップエンドポイントの設定
    const requestConfig = {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: simplifiedQuery,
        num: 5, // 返却件数を減らす
        safe: 'active',
        fields: 'items(title,link,snippet)' // 返却フィールドを限定
      },
      timeout: 15000
    };
    
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', requestConfig);
    
    if (response.data && response.data.items && response.data.items.length > 0) {
      console.log(`フォールバック検索成功: ${response.data.items.length}件`);
      return response.data.items.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      }));
    }
    
    throw new Error('フォールバック検索でも結果が得られませんでした');
  } catch (error) {
    console.error('フォールバック検索エラー:', error.message);
    
    // 最後の手段: 空の検索結果配列を返す
    console.log('最終フォールバック: プレースホルダー検索結果を返します');
    return [
      {
        title: `${query} - 企業情報`,
        link: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: `${query}に関する情報。検索サービスの一時的な問題により詳細情報を取得できませんでした。`
      }
    ];
  }
}

/**
 * Google Custom Search APIを使用して検索
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果の配列
 */
async function googleSearch(query) {
  try {
    console.log(`Googleで検索: "${query}"`);

    // Railway環境の場合、クエリのエンコーディングとリクエスト設定を調整
    const searchQuery = IS_RAILWAY ? encodeURIComponent(query) : query;
    
    // デバッグ: Railway環境ではリクエスト詳細をログ出力
    if (IS_RAILWAY) {
      console.log(`Railway環境検出: 検索クエリをエンコード "${query}" -> "${searchQuery}"`);
      console.log(`API設定: key=${GOOGLE_API_KEY ? GOOGLE_API_KEY.substring(0, 5) + '...' : '未設定'}, cx=${GOOGLE_SEARCH_ENGINE_ID || '未設定'}`);
    }
    
    // リクエスト設定オブジェクト
    const requestConfig = {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: IS_RAILWAY ? searchQuery : query,
        num: 10
      },
      // Railway環境ではタイムアウトを長めに設定
      timeout: IS_RAILWAY ? 10000 : 5000
    };
    
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', requestConfig);
    
    if (response.data && response.data.items) {
      console.log(`検索結果: ${response.data.items.length}件`);
      return response.data.items.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      }));
    }
    
    // 検索結果がない場合は空の配列ではなくエラーをスロー
    console.log('検索結果なし');
    throw new Error(`"${query}"の検索結果がありませんでした。`);
  } catch (error) {
    console.error('Google Search API error:', error.message);
    // エラーの詳細情報をログに出力（デバッグ用）
    if (error.response) {
      // サーバーからのレスポンスがある場合
      console.error('API Response Error:', {
        status: error.response.status,
        data: JSON.stringify(error.response.data).substring(0, 500), // レスポンスデータを短く切り詰めて表示
        headers: JSON.stringify(error.response.headers)
      });
    } else if (error.request) {
      // リクエストは送信されたがレスポンスがない場合
      console.error('API Request Error:', typeof error.request === 'object' ? 'リクエストオブジェクト(詳細省略)' : error.request);
    } else {
      // リクエスト設定時にエラーが発生した場合
      console.error('API Error Config:', error.config ? JSON.stringify(error.config) : '設定なし');
    }
    
    // Railway環境での致命的なエラーの場合、バックアップロジックを使用
    if (IS_RAILWAY && (error.response?.status === 400 || error.response?.status === 403)) {
      console.log('Railway環境でのAPI障害を検出: フォールバック検索を使用します');
      return await railwayFallbackSearch(query);
    }
    
    throw new Error(`Google検索でエラーが発生しました: ${error.message}`);
  }
}

/**
 * Claude APIを使用して情報を抽出
 * @param {string} companyName - 会社名
 * @param {Array} searchResults - 検索結果
 * @returns {Promise<Object>} - 抽出された会社情報
 */
async function extractInfoWithClaude(companyName, searchResults) {
  console.log(`Claude APIで情報抽出: "${companyName}"`);
  
  const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!CLAUDE_API_KEY) {
    console.error('ANTHROPIC_API_KEY環境変数が設定されていません');
    throw new Error('ANTHROPIC_API_KEY環境変数が設定されていません');
  }
  
  // 検索結果を整形
  const formattedResults = searchResults.map(result => {
    return `タイトル: ${result.title}\nリンク: ${result.link}\n説明: ${result.snippet}\n`;
  }).join('\n');
  
  const prompt = `
あなたは日本の企業情報を抽出するアシスタントです。以下の検索結果をもとに、「${companyName}」の会社情報を抽出してください：

検索結果:
${formattedResults}

検索結果から以下の情報を抽出し、JSON形式で出力してください：
1. 郵便番号 (postalCode): 数字7桁のみで表記（ハイフンなし）
2. 都道府県 (prefecture)
3. 市区町村 (city)
4. それ以降の住所 (address)
5. 代表者の役職名 (representativeTitle)
6. 代表者の氏名 (representativeName)

情報が見つからない場合は空文字（""）としてください。
回答は次の形式のみで出力してください：

{
  "postalCode": "郵便番号（数字のみ）",
  "prefecture": "都道府県",
  "city": "市区町村",
  "address": "それ以降の住所",
  "representativeTitle": "代表者の役職名",
  "representativeName": "代表者の氏名"
}
`;

  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      const response = await axios({
        method: 'post',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        data: {
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1
        },
        timeout: 30000 // タイムアウトを30秒に設定
      });

      // レスポンスからJSON部分を抽出
      if (!response.data || !response.data.content || !response.data.content[0] || !response.data.content[0].text) {
        console.error('Claude APIからのレスポンスにデータがありません');
        throw new Error('Claudeからのレスポンスでデータがありませんでした。');
      }

      const content = response.data.content[0].text;
      console.log('Claude APIのレスポンス:', content.substring(0, 100) + '...');
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const parsedData = JSON.parse(jsonMatch[0]);
          
          // ログとして抽出された情報を出力
          console.log('抽出された情報:', JSON.stringify(parsedData, null, 2));
          
          // すべてのフィールドが空の場合はエラーとする代わりに警告を表示
          const allEmpty = !parsedData.postalCode && 
                         !parsedData.prefecture && 
                         !parsedData.city && 
                         !parsedData.address && 
                         !parsedData.representativeTitle && 
                         !parsedData.representativeName;
                         
          if (allEmpty) {
            console.warn('すべてのフィールドが空です。情報が十分に抽出されませんでした。');
          }
          
          return parsedData;
        } catch (parseError) {
          console.error('JSON解析エラー:', parseError);
          throw new Error('抽出された情報をJSONとして解析できませんでした。');
        }
      }
      
      throw new Error('Claudeからの応答をJSONとして解析できませんでした。');
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // エラー情報をより詳細に記録
      console.error(`Claude API error (attempt ${retryCount}/${MAX_RETRIES}):`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      if (retryCount >= MAX_RETRIES) {
        console.error(`Claude API最大リトライ回数(${MAX_RETRIES})に達しました`);
        break;
      }
      
      // バックオフ時間を計算（指数バックオフ: 1秒、2秒、4秒...）
      const backoffTime = Math.pow(2, retryCount - 1) * 1000;
      console.log(`${backoffTime}ms後に再試行します...`);
      
      // 待機してから再試行
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }

  throw new Error(`Claude APIでエラーが発生しました: ${lastError.message}`);
}

/**
 * Claude APIを使用して情報を検証
 * @param {string} companyName - 会社名
 * @param {Object} firstInfo - 最初に抽出した情報
 * @param {Array} factCheckResults - ファクトチェック用の検索結果
 * @returns {Promise<Object>} - 検証された会社情報
 */
async function validateInfoWithClaude(companyName, factCheckResults, firstInfo) {
  console.log(`Claude APIで情報検証: "${companyName}"`);
  
  const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!CLAUDE_API_KEY) {
    console.error('ANTHROPIC_API_KEY環境変数が設定されていません');
    throw new Error('ANTHROPIC_API_KEY環境変数が設定されていません');
  }
  
  const prompt = `
あなたは日本の企業情報を検証する専門家です。「${companyName}」について以下の情報が抽出されました：

最初の抽出結果:
${JSON.stringify(firstInfo, null, 2)}

追加の検索結果:
${JSON.stringify(factCheckResults, null, 2)}

追加の検索結果を分析し、最初の抽出結果を検証・修正してください。一貫性のある正確な情報を提供することが目標です。

以下の点に注意してください：
1. 郵便番号は数字7桁の形式にしてください（例: "1000001"）
2. 住所は都道府県、市区町村、残りの住所に正しく分けてください
3. 代表者の役職名と氏名を正確に区別してください
4. 矛盾する情報がある場合は、より信頼性の高い情報源からの情報を優先してください
5. 情報が見つからない場合は空欄にしてください
6. 情報が確認できない場合は、推測せず空欄としてください

検証結果を以下のJSON形式で提供してください：
{
  "postalCode": "郵便番号（数字のみ）",
  "prefecture": "都道府県",
  "city": "市区町村",
  "address": "残りの住所",
  "representativeTitle": "代表者の役職名",
  "representativeName": "代表者の氏名"
}
`;

  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      const response = await axios({
        method: 'post',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        data: {
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1
        },
        timeout: 30000 // タイムアウトを30秒に設定
      });

      // レスポンスからJSON部分を抽出
      if (!response.data || !response.data.content || !response.data.content[0] || !response.data.content[0].text) {
        console.error('Claude APIからのレスポンスにデータがありません');
        throw new Error('Claudeからのレスポンスでデータがありませんでした。');
      }

      const content = response.data.content[0].text;
      console.log('Claude API検証のレスポンス:', content.substring(0, 100) + '...');
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const parsedData = JSON.parse(jsonMatch[0]);
          
          // 検証された情報をログとして出力
          console.log('検証された情報:', JSON.stringify(parsedData, null, 2));
          
          return parsedData;
        } catch (parseError) {
          console.error('JSON解析エラー:', parseError);
          throw new Error('検証結果をJSONとして解析できませんでした。');
        }
      }
      
      throw new Error('Claudeからの応答をJSONとして解析できませんでした。');
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // エラー情報をより詳細に記録
      console.error(`Claude API error (attempt ${retryCount}/${MAX_RETRIES}):`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      if (retryCount >= MAX_RETRIES) {
        console.error(`Claude API最大リトライ回数(${MAX_RETRIES})に達しました`);
        break;
      }
      
      // バックオフ時間を計算（指数バックオフ: 1秒、2秒、4秒...）
      const backoffTime = Math.pow(2, retryCount - 1) * 1000;
      console.log(`${backoffTime}ms後に再試行します...`);
      
      // 待機してから再試行
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }

  throw new Error(`Claude APIでエラーが発生しました: ${lastError.message}`);
}

module.exports = {
  searchCompanyInfo
}; 