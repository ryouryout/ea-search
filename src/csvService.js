const { Parser } = require('json2csv');

/**
 * 会社情報の配列をCSV形式に変換する
 * @param {Array} results - 会社情報の配列
 * @returns {string} - CSV形式の文字列
 */
function convertToCSV(results) {
  // CSVのフィールド定義
  const fields = [
    { 
      label: '会社名',
      value: 'companyName'
    },
    { 
      label: '郵便番号',
      value: 'postalCode'
    },
    { 
      label: '都道府県',
      value: 'prefecture'
    },
    { 
      label: '市区町村',
      value: 'city'
    },
    { 
      label: '残りの住所',
      value: 'address'
    },
    { 
      label: '代表者の役職名',
      value: 'representativeTitle'
    },
    { 
      label: '代表者名',
      value: 'representativeName'
    }
  ];

  // オプション設定
  const opts = { 
    fields,
    delimiter: ',',
    eol: '\n', // End of line
    header: true,
    quote: '"',
    escape: '"'
  };

  try {
    // CSVパーサーのインスタンス作成
    const parser = new Parser(opts);
    
    // データをCSV形式に変換
    const csv = parser.parse(results);
    
    return csv;
  } catch (err) {
    console.error('CSV変換エラー:', err);
    throw new Error('CSVへの変換に失敗しました');
  }
}

module.exports = {
  convertToCSV
}; 