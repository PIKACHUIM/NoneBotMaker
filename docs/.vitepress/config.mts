import { defineConfig } from 'vitepress';

const zhSidebar = [
  {
    text: '开始使用',
    items: [
      { text: '快速部署', link: '/guide/quick-start' },
      { text: '管理台使用教程', link: '/guide/user-guide' },
    ],
  },
  {
    text: '需求与设计',
    items: [
      { text: '项目需求', link: '/design/requirements' },
      { text: '系统设计', link: '/design/architecture' },
    ],
  },
  {
    text: '开发与运维',
    items: [
      { text: '本地开发与测试', link: '/development/setup' },
      { text: '多平台部署', link: '/development/deployment' },
      { text: '日志保留与清理', link: '/operations/log-retention' },
    ],
  },
];

const enSidebar = [
  {
    text: 'Get Started',
    items: [
      { text: 'Quick Deployment', link: '/en/guide/quick-start' },
      { text: 'Admin Console Guide', link: '/en/guide/user-guide' },
    ],
  },
  {
    text: 'Requirements & Design',
    items: [
      { text: 'Project Requirements', link: '/en/design/requirements' },
      { text: 'System Architecture', link: '/en/design/architecture' },
    ],
  },
  {
    text: 'Development & Operations',
    items: [
      { text: 'Local Development & Tests', link: '/en/development/setup' },
      { text: 'Platform Deployment', link: '/en/development/deployment' },
      { text: 'Log Retention', link: '/en/operations/log-retention' },
    ],
  },
];

export default defineConfig({
  base: '/NoneBotMaker/',
  title: 'NoneBotMaker',
  description: '面向 QQ 官方机器人的 Serverless 管理与聊天服务',
  cleanUrls: true,
  lastUpdated: true,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'NoneBotMaker 文档',
      description: 'NoneBotMaker 项目介绍、使用教程、需求与设计文档',
      themeConfig: {
        nav: [
          { text: '快速部署', link: '/guide/quick-start' },
          { text: '使用教程', link: '/guide/user-guide' },
          { text: '项目设计', link: '/design/architecture' },
          { text: 'GitHub', link: 'https://github.com/PIKACHUIM/NoneBotMaker' },
        ],
        sidebar: zhSidebar,
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      title: 'NoneBotMaker Docs',
      description: 'Project overview, tutorials, requirements, and design documents for NoneBotMaker',
      themeConfig: {
        nav: [
          { text: 'Quick Deploy', link: '/en/guide/quick-start' },
          { text: 'User Guide', link: '/en/guide/user-guide' },
          { text: 'Architecture', link: '/en/design/architecture' },
          { text: 'GitHub', link: 'https://github.com/PIKACHUIM/NoneBotMaker' },
        ],
        sidebar: enSidebar,
      },
    },
  },
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/PIKACHUIM/NoneBotMaker' }],
  },
});
