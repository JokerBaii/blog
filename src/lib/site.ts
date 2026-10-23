export const site = {
  name: "Jokerbai Lab",
  title: "Jokerbai Lab",
  description: "一个路过的大学生，记录 C++、点云和与她有关的日常。",
  author: "jokerbai",
  keywords: ["jokerbai", "Jokerbai Lab", "个人博客", "C++", "点云", "大学生活", "学习笔记"],
  nav: [
    { href: "/", label: "HOME", icon: "tabler:home-heart", hint: "front page" },
    { href: "/blog/", label: "BLOG", icon: "tabler:book-2", hint: "notes" },
    { href: "/games/", label: "LINKS", icon: "tabler:external-link", hint: "daily links" },
    { href: "/projects/", label: "WORKS", icon: "tabler:code", hint: "projects" },
    { href: "/about/", label: "ME", icon: "tabler:user-heart", hint: "profile" }
  ]
};

export const categoryLabel: Record<string, string> = {
  tech: "技术开发",
  anime: "二次元",
  life: "日常记录"
};
