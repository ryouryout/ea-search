const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;

// 環境変数のログ出力（機密情報を隠して）
console.log('環境変数の確認:');
console.log('- GOOGLE_SEARCH_API_KEY:', GOOGLE_API_KEY ? `設定済み (${GOOGLE_API_KEY.substring(0, 5)}...)` : '未設定');
console.log('- GOOGLE_SEARCH_ENGINE_ID:', GOOGLE_SEARCH_ENGINE_ID || '未設定');
console.log('- ANTHROPIC_API_KEY:', CLAUDE_API_KEY ? `設定済み (${CLAUDE_API_KEY.substring(0, 5)}...)` : '未設定');

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
 * 会社情報を取得
 * @param {string} companyName - 会社名
 * @param {function} progressCallback - 進捗通知用コールバック関数（オプション）
 * @returns {Promise<Object>} - 会社情報オブジェクト
 */
async function getCompanyInfo(companyName, progressCallback) {
  try {
    // 検索クエリを作成
    const searchQuery = `${companyName} 会社概要 本社 住所 代表`;
    
    // Google検索を実行
    const searchResults = await googleSearch(searchQuery);
    
    // 進捗を通知
    if (progressCallback) {
      progressCallback('情報を抽出中...', 2);
    } else {
      console.log(`Search progress: ${companyName} - 情報を抽出中... (2)`);
    }
    
    // Claude APIで情報を抽出
    const extractedInfo = await extractInfoWithClaude(companyName, searchResults);
    
    // 追加情報を検索するためのクエリを生成
    const additionalQuery = `${companyName} 郵便番号 ${extractedInfo.postalCode}`;
    
    // 進捗を通知
    if (progressCallback) {
      progressCallback('追加情報を検索中...', 3);
    } else {
      console.log(`Search progress: ${companyName} - 追加情報を検索中... (3)`);
    }
    
    console.log(`生成された追加検索クエリ: "${additionalQuery}"`);
    
    // 追加情報を検索
    const additionalResults = await googleSearch(additionalQuery);
    
    // 進捗を通知
    if (progressCallback) {
      progressCallback('情報を検証中...', 4);
    } else {
      console.log(`Search progress: ${companyName} - 情報を検証中... (4)`);
    }
    
    // Claude APIで情報を検証
    const validatedInfo = await validateInfoWithClaude(companyName, additionalResults, extractedInfo);
    
    // 進捗を通知
    if (progressCallback) {
      progressCallback('検索完了', 5);
    } else {
      console.log(`Search progress: ${companyName} - 検索完了 (5)`);
    }
    
    return {
      companyName,
      ...validatedInfo
    };
  } catch (error) {
    throw error;
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
    
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 10
      }
    });
    
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
        data: error.response.data,
        headers: error.response.headers
      });
    } else if (error.request) {
      // リクエストは送信されたがレスポンスがない場合
      console.error('API Request Error:', error.request);
    } else {
      // リクエスト設定時にエラーが発生した場合
      console.error('API Error Config:', error.config);
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