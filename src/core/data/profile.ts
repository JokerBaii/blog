export const profileIdentity = {
  displayName: "jokerbai",
  handle: "Jokerbaii",
  siteName: "Jokerbai Lab",
  bio: "一个路过的大学生。和 C++、点云慢慢较劲，也认真喜欢着女朋友。这里放学习笔记、折腾记录，以及普通日子里的小开心。",
  github: "https://github.com/Jokerbaii",
  qq: "150925418"
} as const;

export const profileStatus = [
  "在 C++ 的报错里慢慢升级",
  "把散落的点，拼成看得懂的世界",
  "最近最喜欢的事：和女朋友待在一起"
] as const;

export const profileTech = [
  { key: "cpp", name: "C++", note: "语法 / STL / 调试笔记" },
  { key: "cloud", name: "点云", note: "三维数据 / 处理思路 / 可视化" },
  { key: "algorithms", name: "算法练习", note: "数据结构 / 一点一点想明白" },
  { key: "cmake", name: "构建与工具", note: "CMake / Git / 环境折腾" },
  { key: "notes", name: "学习记录", note: "踩坑整理 / 随手笔记" }
] as const;

export const animeFavorites = [
  { key: "engage-kiss", title: "契约之吻", subtitle: "给日常加一点心动" },
  { key: "aobuta", title: "青春猪头少年系列", subtitle: "青春里那些说不清的心事" },
  { key: "charlotte", title: "夏洛特", subtitle: "下课之后的另一个世界" },
  { key: "summer-pockets", title: "Summer Pockets", subtitle: "把夏天留在存档里" }
] as const;

export const xpFavorites = [
  { key: "catgirl", title: "女朋友", subtitle: "my favorite person" },
  { key: "pink-hair", title: "一起散步", subtitle: "one more walk together" },
  { key: "yandere", title: "认真回消息", subtitle: "always happy to hear from you" },
  { key: "heavy-love", title: "普通日子", subtitle: "little things, good days" }
] as const;

export const favoriteGames = [
  { key: "cyberpunk-2077", title: "课间小游戏", subtitle: "下课了，脑袋也休息一下" },
  { key: "the-finals", title: "双人合作", subtitle: "通关很开心，一起玩更开心" },
  { key: "kovaaks", title: "周末存档", subtitle: "给忙碌的一周按个暂停" },
  { key: "aimlabs", title: "和她一起玩", subtitle: "输赢随意，队友固定" }
] as const;

export const currentSignals = [
  { label: "正在学习", text: "C++ 和点云。先把一个报错解决，再让一团点慢慢变得有头绪。" },
  { label: "最近在折腾", text: "把课堂笔记和踩坑过程搬进博客，给以后又忘了的自己留个路标。" },
  { label: "今日偏爱", text: "最近喜欢女朋友。代码可以明天再调，今天的晚风想和她一起吹。" }
] as const;
