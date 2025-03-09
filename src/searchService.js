const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

/**
 * 複数の会社情報を検索する
 * @param {string[]} companies - 検索する会社名の配列
 * @returns {Promise<Array>} - 会社情報の配列
 */
async function searchCompanyInfo(companies) {
  const results = [];
  
  // 各会社を順番に処理
  for (const companyName of companies) {
    try {
      console.log(`Searching for company: ${companyName}`);
      
      // 会社情報を検索
      const companyInfo = await getCompanyInfo(companyName);
      
      // 結果を追加
      results.push({
        companyName,
        ...companyInfo
      });
      
      // 検索完了を通知
      if (global.notifySearchComplete) {
        global.notifySearchComplete(companyName, true);
      }
      
      // APIレートリミットを考慮して少し待機
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Error searching for ${companyName}:`, error);
      // エラーを記録し、エラー情報を含めて結果に追加
      results.push({
        companyName,
        error: error.message || 'Unknown error occurred',
        errorOccurred: true
      });
      
      // エラーを通知
      if (global.notifySearchComplete) {
        global.notifySearchComplete(companyName, false, error.message);
      }
    }
  }
  
  return results;
}

/**
 * 単一の会社情報を取得する
 * @param {string} companyName - 検索する会社名
 * @returns {Promise<Object>} - 会社情報のオブジェクト
 */
async function getCompanyInfo(companyName) {
  // APIキーが設定されているか確認
  if (!GOOGLE_API_KEY || !GOOGLE_SEARCH_ENGINE_ID || !CLAUDE_API_KEY) {
    throw new Error('APIキーが設定されていません。環境変数を確認してください。');
  }

  // プロセス通知ヘルパー関数
  const notifyStep = (step, stepNumber) => {
    if (global.notifySearchProgress) {
      global.notifySearchProgress(companyName, step, stepNumber);
    }
  };

  try {
    // ステップ1: 最初の検索実行
    notifyStep('基本情報を検索中...', 1);
    const searchTerm = `${companyName} 会社概要 本社 住所 代表`;
    const searchResults = await searchWithGoogle(searchTerm);
    
    if (!searchResults || searchResults.length === 0) {
      throw new Error('検索結果が見つかりませんでした。');
    }
    
    // ステップ2: Claudeを使って検索結果から情報を抽出
    notifyStep('情報を抽出中...', 2);
    const firstExtraction = await extractInfoWithClaude(companyName, searchResults);
    
    // ステップ3: ファクトチェック用に追加の検索を実行
    notifyStep('追加情報を検索中...', 3);
    const additionalSearchQuery = generateAdditionalSearchQuery(companyName, firstExtraction);
    const factCheckResults = await searchWithGoogle(additionalSearchQuery);
    
    // ステップ4: Claudeに再度、抽出と検証を依頼
    notifyStep('情報を検証中...', 4);
    const verifiedInfo = await verifyInfoWithClaude(companyName, firstExtraction, factCheckResults);
    
    // ステップ5: 検索完了
    notifyStep('検索完了', 5);
    
    return verifiedInfo;
  } catch (error) {
    // エラーが発生した場合はエラーステップを通知
    notifyStep(`エラー: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Google Custom Search APIを使用して検索
 * @param {string} query - 検索クエリ
 * @returns {Promise<Array>} - 検索結果の配列
 */
async function searchWithGoogle(query) {
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
    throw new Error(`Google検索でエラーが発生しました: ${error.message}`);
  }
}

/**
 * ファクトチェック用の追加検索クエリを生成
 * @param {string} companyName - 会社名
 * @param {Object} firstInfo - 最初に抽出した情報
 * @returns {string} - 追加検索クエリ
 */
function generateAdditionalSearchQuery(companyName, firstInfo) {
  const { postalCode, prefecture, city, representativeName } = firstInfo;
  
  // より具体的な検索クエリを作成
  let queries = [];
  
  // 基本クエリ
  queries.push(`${companyName} 企業情報`);
  
  // 住所に関する情報があれば追加
  if (prefecture || city) {
    queries.push(`${companyName} ${prefecture || ''} ${city || ''} 本社所在地`);
  } else {
    queries.push(`${companyName} 本社所在地`);
  }
  
  // 代表者に関する情報があれば追加
  if (representativeName) {
    queries.push(`${companyName} ${representativeName} 代表取締役`);
  } else {
    queries.push(`${companyName} 代表取締役`);
  }
  
  // 郵便番号に関する情報があれば追加
  if (postalCode) {
    queries.push(`${companyName} 郵便番号 ${postalCode}`);
  }
  
  // 最も詳細なクエリを選択
  const finalQuery = queries.reduce((a, b) => a.length > b.length ? a : b);
  
  console.log(`生成された追加検索クエリ: "${finalQuery}"`);
  return finalQuery;
}

/**
 * Claude APIを使用して検索結果から会社情報を抽出
 * @param {string} companyName - 会社名
 * @param {Array} searchResults - 検索結果の配列
 * @returns {Promise<Object>} - 抽出された会社情報
 */
async function extractInfoWithClaude(companyName, searchResults) {
  console.log(`Claude APIで情報抽出: "${companyName}"`);
  
  const prompt = `
あなたは日本の企業情報を専門に扱う調査アシスタントです。以下の検索結果から、企業「${companyName}」に関する情報を抽出してください。

検索結果:
${JSON.stringify(searchResults, null, 2)}

以下の情報を抽出し、指定されたJSON形式で回答してください。情報が見つからない場合は空文字列にしてください。

1. 郵便番号: 数字7桁のみを抽出してください（ハイフンなし）。例: "1000001"
2. 都道府県: 都道府県名のみを抽出してください。例: "東京都"
3. 市区町村: 市区町村名のみを抽出してください。例: "千代田区"
4. 残りの住所: 都道府県と市区町村を除いた住所を抽出してください。
5. 代表者の役職名: 代表取締役社長、代表取締役、CEOなど。
6. 代表者の氏名: 姓名を抽出してください。

必ずこの形式のJSONで回答してください:
{
  "postalCode": "1234567",
  "prefecture": "東京都",
  "city": "千代田区",
  "address": "丸の内1-1-1",
  "representativeTitle": "代表取締役社長",
  "representativeName": "山田太郎"
}

会社のウェブサイトや信頼性の高いビジネスディレクトリからの情報を優先してください。郵便番号は数字7桁のフォーマットのみを使用し、住所は正確に都道府県・市区町村・残りの住所に分けてください。
`;

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
      }
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
    }
    
    throw new Error('Claudeからの応答をJSONとして解析できませんでした。');
  } catch (error) {
    console.error('Claude API error:', error.message);
    throw new Error(`Claude APIでエラーが発生しました: ${error.message}`);
  }
}

/**
 * Claude APIを使用して情報を検証
 * @param {string} companyName - 会社名
 * @param {Object} firstInfo - 最初に抽出した情報
 * @param {Array} factCheckResults - ファクトチェック用の検索結果
 * @returns {Promise<Object>} - 検証された会社情報
 */
async function verifyInfoWithClaude(companyName, firstInfo, factCheckResults) {
  console.log(`Claude APIで情報検証: "${companyName}"`);
  
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
      }
    });

    // レスポンスからJSON部分を抽出
    if (!response.data || !response.data.content || !response.data.content[0] || !response.data.content[0].text) {
      console.error('Claude APIの検証応答にデータがありません');
      throw new Error('Claudeからのレスポンスでデータがありませんでした。');
    }

    const content = response.data.content[0].text;
    console.log('Claude API検証のレスポンス:', content.substring(0, 100) + '...');
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsedData = JSON.parse(jsonMatch[0]);
      
      // ログとして検証された情報を出力
      console.log('検証された情報:', JSON.stringify(parsedData, null, 2));
      
      return parsedData;
    }
    
    throw new Error('Claudeからの応答をJSONとして解析できませんでした。');
  } catch (error) {
    console.error('Claude API verification error:', error.message);
    throw new Error(`Claude APIで情報の検証中にエラーが発生しました: ${error.message}`);
  }
}

module.exports = {
  searchCompanyInfo
}; 