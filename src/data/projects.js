export const projects = [
  {
    id: 'vrnavi',
    title: 'ぶいなび',
    category: 'メディア運営',
    summary: '初心者にも分かりやすく、VRChatを楽しむための情報を届けるメディア。',
    description:
      '専門用語や前提知識の多さで、VRChatを楽しむ前に離れてしまう人を減らしたいと考え、共同で立ち上げたメディアです。記事の企画・制作、SEO、データ分析、外部とのやり取り、9人チームの進行管理を担当しています。',
    highlights: ['共同で立ち上げ、9人チームで運営', '記事企画・SEO・読者データをもとに改善', '月間最高25万PV・アクティブユーザー6万人規模'],
    facts: [
      { value: '25万', label: '月間最高PV' },
      { value: '6万', label: 'アクティブユーザー' },
      { value: '9人', label: '運営チーム' },
    ],
    tags: ['WordPress', 'SEO', 'Analytics', 'Media'],
    cover: {
      src: '/projects/vrnavi/cover.webp',
      alt: 'ぶいなびのトップページ',
    },
    media: {
      type: 'iframe',
      src: 'https://vrnavi.jp',
      title: 'ぶいなびのサイトプレビュー',
    },
    links: [
      { type: 'website', url: 'https://vrnavi.jp', label: 'Visit Site' },
      { type: 'youtube', url: 'https://www.youtube.com/@vrcnavi', label: 'YouTube' },
      { type: 'x', url: 'https://x.com/vrcnavi', label: 'X (Twitter)' },
    ],
  },
  {
    id: 'facemixer',
    title: 'FaceMixer',
    category: 'VRChat向けツール',
    summary: '表情作りに迷ったとき、ボタンひとつで新しい表情のきっかけを作る。',
    description:
      'VRChatアバターの表情をランダム生成するUnity Editor拡張です。「表情を作るのが難しい」という声から、専門知識がなくても試せて、自分らしい表情を見つける出発点になることを目指しました。',
    highlights: ['目・眉・口を個別またはまとめてランダム生成', '左右対称を保ちながら自然な表情を作成', 'ライブプレビューとアニメーション書き出しに対応'],
    facts: [
      { value: '1,000+', label: 'BOOTHいいね' },
      { value: 'v3.0.0', label: '公開バージョン' },
      { value: 'Unity', label: 'Editor拡張' },
    ],
    tags: ['C#', 'Unity', 'VRChat', 'Editor Tool'],
    cover: {
      src: '/projects/facemixer/cover.webp',
      alt: 'FaceMixerの製品イメージ',
    },
    media: {
      type: 'video',
      src: '/gallery/FaceMixer紹介動画.mp4',
      title: 'FaceMixer紹介動画',
    },
    links: [{ type: 'booth', url: 'https://booth.pm/ja/items/6819792', label: 'BOOTH Page' }],
  },
  {
    id: 'vrcosme',
    title: 'VRCosme',
    category: '写真編集アプリ',
    summary: 'SNSへ投稿する前に、VRChatで撮った写真を迷わず整える。',
    description:
      'VRChatの写真を簡単にレタッチできるWindowsアプリです。高度な画像編集機能を増やすよりも、SNSへ投稿する前に気になる部分を短い操作で整えられることを重視しています。',
    highlights: ['読み込み・調整・比較・保存の4ステップ', '基本補正、トリミング、比較、Undo / Redoに対応', 'PNG・JPEG・WebPの読み込みに対応'],
    facts: [
      { value: '4 step', label: '編集の流れ' },
      { value: 'Windows', label: '10 / 11対応' },
      { value: '3形式', label: '画像読み込み' },
    ],
    tags: ['C#', 'Windows', 'Image Editing', 'VRChat'],
    cover: {
      src: '/projects/vrcosme/cover.webp',
      alt: 'VRCosmeの紹介画面',
    },
    media: {
      type: 'video',
      src: '/gallery/VRCosme紹介動画.mp4',
      title: 'VRCosme紹介動画',
    },
    gallery: [
      {
        src: '/projects/vrcosme/before-after.webp',
        alt: 'VRCosmeで補正する前後の比較',
        caption: '補正前と補正後を見比べながら調整できます。',
      },
    ],
    links: [
      { type: 'website', url: 'https://natuki53.github.io/VRCosme/', label: 'Visit Site' },
      { type: 'booth', url: 'https://mofumagic.booth.pm/items/8035872', label: 'BOOTH Page' },
      { type: 'github', url: 'https://github.com/natuki53/VRCosme', label: 'GitHub' },
    ],
  },
  {
    id: 'vrcosme-web',
    title: 'VRCosme Web',
    category: 'Webアプリ / 写真体験',
    summary: 'レタッチから作品の共有まで、VRChatの写真をブラウザで楽しむ場所。',
    description:
      'VRCosmeをブラウザとデスクトップへ広げた写真プラットフォームです。手軽なレタッチに加えて、フォトコンテストやギャラリー、Windowsアプリとの連携まで、写真を撮った後の体験をひとつにつなげています。',
    highlights: ['ログインなしでもブラウザからレタッチを開始', 'フォトコンテストと作品ギャラリーを用意', 'Windowsアプリから写真管理とクラウド連携を支援'],
    facts: [
      { value: 'Web', label: 'ブラウザですぐ利用' },
      { value: 'PWA', label: '端末に合わせて利用' },
      { value: 'Tauri', label: 'Windowsアプリ' },
    ],
    tags: ['React', 'TypeScript', 'Cloudflare', 'Tauri'],
    cover: {
      src: '/projects/vrcosme-web/cover.webp',
      alt: 'VRCosme Webのトップページ',
    },
    links: [{ type: 'website', url: 'https://vrcosme.com/', label: 'Visit Site' }],
  },
  {
    id: 'cliprack',
    title: 'ClipRack',
    category: 'macOSアプリ',
    summary: 'よく使うコピーを、必要なときにすぐ取り出せる。',
    description:
      'クリップボードの履歴を保存し、キーボードだけでもすばやく呼び出せるmacOS向けアプリです。テキストだけでなく、画像・ファイル・URLにも対応しています。',
    highlights: ['最大100件のクリップボード履歴を保存', '⌘⇧Vで開き、選択してEnterで貼り付け', 'テキスト・画像・ファイル・URLとピン留めに対応'],
    facts: [
      { value: '100件', label: '保存できる履歴' },
      { value: '⌘⇧V', label: '呼び出しキー' },
      { value: 'macOS 13+', label: '対応環境' },
    ],
    tags: ['Swift', 'SwiftUI', 'macOS', 'Productivity'],
    cover: {
      src: '/projects/cliprack/cover.webp',
      alt: 'ClipRackの紹介ページ',
    },
    links: [
      { type: 'website', url: 'https://natuki53.github.io/ClipRack-docs/', label: 'Visit Site' },
      { type: 'testflight', url: 'https://testflight.apple.com/join/YEPq8pt7', label: 'TestFlight' },
      { type: 'github', url: 'https://github.com/natuki53/ClipRack-docs', label: 'GitHub' },
    ],
  },
  {
    id: 'campustrade',
    title: 'CampusTrade',
    category: 'チーム開発 / Webアプリ',
    summary: '学生同士のリユースを、出品から受け渡しまで支えるマーケット。',
    description:
      '教科書や生活用品を学生同士で出品・購入できるフリーマーケットシステムです。要件定義からDB設計、認証・権限、取引状態、モデレーションまでをチームで設計し、ひとつのWebアプリとして実装しました。',
    highlights: ['商品出品・検索・画像管理・購入申し込みを実装', '出品中・取引中・完了の状態遷移とメッセージ機能', 'Spring Securityによる本人確認と管理者モデレーション'],
    facts: [
      { value: '3 states', label: '取引ステータス' },
      { value: '5枚', label: '商品画像の上限' },
      { value: 'Java 21', label: '実行環境' },
    ],
    tags: ['Java', 'Spring Boot', 'Thymeleaf', 'MySQL'],
    cover: {
      src: '/projects/campustrade/cover.webp',
      alt: 'CampusTradeの画面プロトタイプ',
    },
    links: [{ type: 'github', url: 'https://github.com/natuki53/CampusTrade', label: 'GitHub' }],
  },
  {
    id: '360-viewer',
    title: '360-viewer',
    category: 'WordPressプラグイン',
    summary: '360度の景色を、記事の中でそのまま体験。',
    description:
      'WordPressのブロックエディターから360度画像を追加し、ドラッグやズームで閲覧できるプラグインです。静止画だけでは伝わりにくいメタバースの空間を、記事上で体験できるようにしました。',
    highlights: ['Gutenbergブロックから360度画像を追加', 'ドラッグ・ズーム・自動回転・全画面に対応', 'レスポンシブ表示と段階的な画像読み込み'],
    facts: [
      { value: 'v1.1.1', label: '公開バージョン' },
      { value: 'Three.js', label: '360度描画' },
      { value: 'Mobile', label: 'レスポンシブ対応' },
    ],
    tags: ['JavaScript', 'PHP', 'Three.js', 'WordPress'],
    media: {
      type: 'iframe',
      src: '/360-viewer/index.html?img=/gallery/png/VRChat_2025-12-03_19-31-18.277_3840x2160.png',
      title: '360-viewerの操作プレビュー',
    },
    links: [
      { type: 'website', url: 'https://vrnavi.jp/photo_world_introduction', label: 'Using Site' },
      { type: 'github', url: 'https://github.com/natuki53/360-viewer', label: 'GitHub' },
    ],
  },
  {
    id: 'timecard',
    title: 'TimeCard Web',
    category: 'チーム開発',
    summary: '打刻と月ごとの確認をシンプルにまとめた勤怠管理Webアプリ。',
    description:
      'チームで設計・実装した勤怠管理サイトです。アプリ全体の設計と実装を担当し、Java ServletとJSP、Apache Tomcat、MySQLで構築しました。現在は自宅サーバーで稼働しています。',
    highlights: ['ログイン、出勤・退勤打刻、月別一覧を実装', 'Java 21、Jakarta Servlet / JSP、MySQLで構築', '利用者・管理者向けマニュアルを作成'],
    facts: [
      { value: 'Java 21', label: '実行環境' },
      { value: 'MySQL 8', label: 'データベース' },
      { value: '2種類', label: '操作マニュアル' },
    ],
    tags: ['Java', 'Jakarta Servlet', 'JSP', 'Tomcat', 'MySQL'],
    cover: {
      src: '/projects/timecard/cover.webp',
      alt: 'TimeCard Webのロゴ',
    },
    links: [
      { type: 'website', url: 'https://mu-natuki.com/timecard-web-school', label: 'Visit Site' },
      { type: 'github', url: 'https://github.com/natuki53/TimeCard-Web-School', label: 'GitHub' },
      { type: 'website', url: 'https://mu-natuki.com/timecard-web-school/manual/', label: 'User Manual' },
      { type: 'website', url: 'https://mu-natuki.com/timecard-web-school/manual-admin/', label: 'Admin Manual' },
    ],
  },
  {
    id: 'toc-ad',
    title: 'TOC AD',
    category: 'WordPressプラグイン',
    summary: '記事の目次下へ広告画像を自動で追加。',
    description:
      'WordPressの記事で、目次の下に広告画像を自動挿入するプラグインです。画像やリンク、alt、表示サイズを管理画面から設定でき、記事ごとの定型作業を減らします。',
    highlights: ['目次ブロック・ショートコード・コメントを検出', '画像、リンク、alt、サイズ、CSSクラスを設定可能', 'プレビューと拡張用フィルターフックを用意'],
    facts: [
      { value: 'MIT', label: 'ライセンス' },
      { value: 'PHP', label: '実装言語' },
      { value: 'WordPress', label: '対応CMS' },
    ],
    tags: ['PHP', 'WordPress', 'Plugin'],
    links: [{ type: 'github', url: 'https://github.com/natuki53/TOC-AD', label: 'GitHub' }],
  },
];
