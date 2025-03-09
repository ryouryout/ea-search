# EA Search (企業情報検索システム)

このアプリケーションは、会社名のリストから企業情報を自動的に検索・抽出し、整理されたデータとして提供するWebアプリケーションです。

## 機能

- 会社名の一括検索
- 会社情報（所在地、代表者、電話番号、設立年）の自動抽出
- リアルタイム進捗表示
- 検索結果のCSVエクスポート
- 検索結果のクリップボードコピー
- WebSocketによるリアルタイム通信

## 技術スタック

- **フロントエンド**: HTML, CSS, JavaScript (vanilla)
- **バックエンド**: Node.js, Express.js
- **検索API**: Google Custom Search API
- **情報抽出**: Anthropic Claude API
- **通信**: WebSocket (ws)

## 環境設定

### 必要なAPI

このアプリケーションを実行するには以下のAPIキーが必要です：

1. **Google Custom Search API キー**
   - [Google Cloud Platform](https://console.cloud.google.com/) でAPIキーを取得
   - [Custom Search Engine](https://cse.google.com/cse/all) で検索エンジンIDを設定

2. **Anthropic Claude API キー**
   - [Anthropic Console](https://console.anthropic.com/) からAPIキーを取得

### ローカル環境でのセットアップ

1. リポジトリをクローン
   ```bash
   git clone https://github.com/ryouryout/ea-search.git
   cd ea-search
   ```

2. 依存パッケージをインストール
   ```bash
   npm install
   ```

3. 環境変数を設定
   - `.env.sample` を `.env` にコピーし、APIキーを設定
   ```bash
   cp .env.sample .env
   # .envファイルを編集して実際のAPIキーを入力
   ```

4. アプリケーションを起動
   ```bash
   npm start
   ```

5. ブラウザでアクセス
   ```
   http://localhost:3001
   ```

## Renderへのデプロイ

このアプリケーションは[Render](https://render.com/)にワンクリックでデプロイできます。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ryouryout/ea-search)

または、手動でデプロイする場合は以下の手順に従ってください：

1. Renderアカウントを作成し、ログイン
2. ダッシュボードから「New +」→「Web Service」を選択
3. GitHub連携から本リポジトリを選択
4. 環境変数を設定
   - `GOOGLE_SEARCH_API_KEY`: Google検索APIキー
   - `GOOGLE_SEARCH_ENGINE_ID`: 検索エンジンID
   - `ANTHROPIC_API_KEY`: AnthropicのAPIキー
5. デプロイをクリック

## 使用方法

1. テキストエリアに会社名を入力（1行に1社）
2. 「検索」ボタンをクリック
3. 検索結果が表示されるまで待機
4. 結果をCSVエクスポートまたはコピーして活用

## 制限事項

- 同時に検索できる会社数は最大500社
- 無料APIプランを使用している場合、検索リクエスト数に制限があります
- Rendering環境のフリープランではスリープモードがあるため、初回アクセス時に遅延が発生する場合があります

## ライセンス

このプロジェクトはMITライセンスのもとで公開されています。

## 作者

@ryouryout 