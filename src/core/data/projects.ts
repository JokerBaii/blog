export const projectTechLines = [
  { key: "cpp", label: "C++", note: "语法 / STL / 调试" },
  { key: "cloud", label: "点云", note: "三维数据 / 处理与观察" },
  { key: "algorithms", label: "算法", note: "数据结构 / 解题思路" },
  { key: "cmake", label: "工具链", note: "CMake / Git / 环境配置" },
  { key: "notes", label: "学习笔记", note: "课堂 / 踩坑 / 日常" }
] as const;

// These are notebook topics and learning plans; add real repositories as they become available.
export const projectEntries = [
  {
    id: "cpp-notes",
    title: "C++ 学习草稿本",
    type: "Learning Notes",
    line: "cpp",
    status: "笔记待整理",
    summary: "从一个能跑的小例子开始，把语法、STL 和编译器的碎碎念整理成自己看得懂的笔记。",
    details: ["基础语法", "STL 小例子", "调试思路"]
  },
  {
    id: "cloud-lab",
    title: "点云观察日记",
    type: "Point Cloud Notes",
    line: "cloud",
    status: "学习方向",
    summary: "一团点乍看很乱，换个角度就有了轮廓。这里准备记录三维数据的读取、观察和处理思路。",
    details: ["数据读取", "点云可视化", "处理流程"]
  },
  {
    id: "algorithm-notes",
    title: "算法慢慢想",
    type: "Problem Solving",
    line: "algorithms",
    status: "练习清单",
    summary: "题目不一定一次想通，但每次卡住的地方都值得记下来。给思路留草稿，也给自己留一点耐心。",
    details: ["数据结构", "思路拆解", "边界检查"]
  },
  {
    id: "build-notes",
    title: "环境折腾备忘录",
    type: "Toolchain Notes",
    line: "cmake",
    status: "待补充",
    summary: "代码还没跑，环境先出了题。把构建、依赖和版本管理的过程记下来，下次少走一点回头路。",
    details: ["CMake 构建", "Git 记录", "环境配置"]
  },
  {
    id: "campus-notes",
    title: "下课后的随手记",
    type: "Campus Journal",
    line: "notes",
    status: "课后归档",
    summary: "课程作业、课间的灵感、和她一起走过的路，都夹进课后的手账里，留给以后慢慢翻。",
    details: ["课程作业", "零碎想法", "和她的普通日子"]
  },
  {
    id: "blog-lab",
    title: "这个博客的小实验",
    type: "Personal Blog",
    line: "notes",
    status: "持续整理",
    summary: "给学习笔记找一个住处，也给生活留一点位置。页面慢慢改，故事慢慢写。",
    details: ["文章归档", "阅读体验", "个人记录"]
  }
] as const;
