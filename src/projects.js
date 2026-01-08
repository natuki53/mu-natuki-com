export const projects = [
    {
        id: "vrnavi",
        title: "ぶいなび",
        description: "VRChatの情報をまとめたサイト。イベント情報やワールド紹介など、VRChatをもっと楽しむための情報を発信しています。<br><br>実際に下のページを操作することができます。",
        tags: ["Site", "WordPress"],
        media: {
            type: 'iframe',
            src: 'https://vrnavi.jp',
            fit: 'cover',
        },
        links: [
            { type: "website", url: "https://vrnavi.jp", label: "Visit Site" },
            { type: "youtube", url: "https://www.youtube.com/@vrcnavi", label: "YouTube" },
            { type: "x", url: "https://x.com/vrcnavi", label: "X(Twitter)" }
        ]
    },
    {
        id: "facemixer",
        title: "FaceMixer",
        description: "VRChatのアバター表情改変を簡単に！Unity上で直感的に表情を作成・編集できるツールです。",
        tags: ["C#", "Unity", "Tool"],
        media: {
            type: 'video',
            src: '/gallery/FaceMixer紹介動画.mp4'
        },
        links: [
            { type: "booth", url: "https://booth.pm/ja/items/6819792", label: "BOOTH Page" }
        ]
    },
    {
        id: "timecard",
        title: "TimeCard Web",
        description: "学校課題で作成した勤怠管理サイト。Javaサーブレットを使用してApache Tomcatで構築しました。自宅サーバーで稼働しています。",
        tags: ["Java", "Web"],
        links: [
            { type: "website", url: "https://mu-natuki.com/timecard-web-school", label: "Visit Site" },
            { type: "website", url: "https://mu-natuki.com/timecard-web-school/manual/", label: "User Manual" },
            { type: "website", url: "https://mu-natuki.com/timecard-web-school/manual-admin/", label: "Admin Manual" },
            { type: "github", url: "https://github.com/natuki53/Timecard-Web-School", label: "GitHub" }
        ]
    },
    {
        id: "booth-import",
        title: "BOOTH Import Assistant",
        description: "BOOTHからのインポートを楽にするツール。購入したアバターや衣装のインポート作業を効率化します。使用するにはブラウザに拡張機能をインストールする必要があります。",
        tags: ["C#", "JavaScript", "Efficiency"],
        media: {
            type: 'video',
            src: '/gallery/BIA宣伝ツール.mp4'
        },
        links: [
            { type: "website", url: "https://natuki53.github.io/Booth_Import_Assistant", label: "Visit Site" },
            { type: "Extension", url: "https://chromewebstore.google.com/detail/booth-import-assistant/melbffodmbnmadeobmdeaomafkadlokd?utm_source=item-share-cb", label: "Store Page" },
            { type: "github", url: "https://github.com/natuki53/BOOTH_Import_Assistant", label: "GitHub" }
        ]
    },
    {
        id: "booth-library",
        title: "BOOTH Library Search",
        description: "BOOTHライブラリをさくさく検索できるChrome拡張機能。購入履歴からの検索をスムーズにします。",
        tags: ["JavaScript", "Extension"],
        links: [
            { type: "github", url: "https://github.com/natuki53/BoothLibrarySearch", label: "GitHub" }
        ]
    },
    {
        id: "360-viewer",
        title: "360-viewer",
        description: "Webブラウザで360度画像が見れるビューワー。メタバースの魅力をより伝わるように実際に操作しながら閲覧できるようにしました。<br><br>実際に下のページを操作することができます。",
        tags: ["JavaScript", "PHP", "Web"],
        media: {
            type: 'iframe',
            src: '/360-viewer/index.html?img=/gallery/VRChat_2025-12-03_19-31-18.277_3840x2160.png'
        },
        links: [
            { type: "website", url: "https://vrnavi.jp/photo_world_introduction", label: "Using Site" },
            { type: "github", url: "https://github.com/natuki53/360-viewer", label: "GitHub" }
        ]
    }
];
