import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { FormInstance, TableColumnsType } from 'antd';
import {
  ApiOutlined,
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  GithubOutlined,
  LoginOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MessageOutlined,
  MinusCircleOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  CHATBOT_PLUGIN_TYPE,
  DEFAULT_NON_MENTION_REPLY_RATE,
} from '../shared/types';
import type {
  BotAccountRecord,
  ConversationLog,
  DatabaseSetupStatus,
  GroupRecord,
  JsonObject,
  Language,
  LibraryKind,
  LibraryRecord,
  ModelPriceRecord,
  PluginFieldDefinition,
  PluginRecord,
  PolicyRecord,
  PolicyType,
  ProjectMemoryRecord,
  MemoryType,
  ProviderRecord,
} from '../shared/types';
import {
  conversationFields,
  conversationIdList,
  defaultFieldValues,
  normalizeFieldValues,
  pluginDefinition,
  pluginDefinitions,
  policyFields,
} from '../shared/plugin-catalog';
import { IMAGE_MODEL_PRICE_CHECKED_AT, MODEL_PRICE_CHECKED_AT, MODEL_PRICE_PRESETS } from '../shared/model-pricing';
import { LanguageProvider, useI18n } from './i18n';
import { ThemeProvider, useTheme, type ThemeMode } from './theme';
import { ApiError, api } from './api';
import type { ChatbotConversationStatus, ChatbotConversationStats, ChatbotConversationSummary, ChatbotMemeSummary, ChatbotSlangCandidate, ChatbotVoiceSummary, ChatbotWake, ConversationMemoryItem, ConversationMemoryInput } from './api';

const { Title, Text, Paragraph } = Typography;
const { Sider, Content } = Layout;

type AdminPage = 'overview' | 'plugins' | 'accounts' | 'groups' | 'conversations' | 'providers' | 'prices' | 'budgets' | 'identities' | 'dialogs' | 'voices' | 'memory-policies' | 'skills' | 'mcps' | 'rules' | 'tools';
type ConversationView = 'status' | 'approvals' | 'logs' | 'statistics' | 'memories';
type Route = { kind: 'home' } | { kind: 'login' } | { kind: 'setup' } | { kind: 'admin'; page: AdminPage; view?: ConversationView };
type LibraryData = Record<LibraryKind, LibraryRecord[]>;
type LogFilters = { q?: string; pluginId?: string; openid?: string; accountId?: string; groupId?: string; from?: string; to?: string };

const libraryNames: Record<LibraryKind, string> = { skills: '技能', mcps: 'MCP', rules: '规则' };
const pageTitles: Record<AdminPage, { title: string; eyebrow: string; description: string }> = {
  overview: { title: '运行总览', eyebrow: 'CONTROL ROOM / 01', description: '按 01 → 05 检查配置：AI、账号、群聊策略与运行状态。' },
  plugins: { title: '插件管理', eyebrow: 'RUNTIME / PLUGINS', description: '管理插件逻辑与技术默认值。' },
  accounts: { title: '平台账号', eyebrow: 'RUNTIME / ACCOUNTS', description: '配置机器人账号凭据与账号范围内的共享项目记忆。' },
  groups: { title: '群聊管理', eyebrow: 'RUNTIME / GROUPS', description: '绑定群聊或私聊，选择复用策略，只保留此群独有的覆盖。' },
  conversations: { title: '会话管理', eyebrow: 'RUNTIME / SESSIONS', description: '查看连接状态、待审批操作、聊天记录与记忆；临时控制只作用于当前会话。' },
  providers: { title: 'AI 供应商', eyebrow: 'MODEL / INTERFACES', description: '管理兼容 API 地址、密钥与供应商支持的模型。' },
  prices: { title: 'AI 模型价格', eyebrow: 'MODEL / PRICING', description: '登记文本与图像模型单价、来源和价格核对日期。' },
  budgets: { title: 'AI 费用策略', eyebrow: 'MODEL / BUDGETS', description: '集中管理可复用预算，群聊只选择费用策略。' },
  identities: { title: '身份策略', eyebrow: 'MODEL / IDENTITY', description: '集中定义人设、基础规则、聊天模型与能力授权。' },
  dialogs: { title: '对话策略', eyebrow: 'MODEL / DIALOG', description: '控制模型流式响应、工具轮数与回复方式。' },
  voices: { title: '语音策略', eyebrow: 'MODEL / VOICE', description: '配置语音合成参数；未选择语音策略表示关闭。' },
  'memory-policies': { title: '记忆策略', eyebrow: 'MODEL / MEMORY', description: '集中管理会话记忆模式、容量与保留期限。' },
  skills: { title: 'Skills', eyebrow: 'MODEL / CAPABILITIES', description: '编辑可复用技能内容；授权在身份策略中管理。' },
  mcps: { title: 'MCP', eyebrow: 'MODEL / CAPABILITIES', description: '管理远端服务与认证；授权在身份策略中管理。' },
  rules: { title: 'Rules', eyebrow: 'MODEL / CAPABILITIES', description: '编辑可复用规则；授权在身份策略中管理。' },
  tools: { title: '工具', eyebrow: 'MODEL / CAPABILITIES', description: '管理内置工具及安全配置；身份策略决定授权范围。' },
};

function currentRoute(): Route {
  const path = window.location.hash.slice(1);
  if (path) {
    if (path === '/setup') return { kind: 'setup' };
    if (path === '/login') return { kind: 'login' };
    if (path.startsWith('/admin')) {
      const [, , requestedPage, requestedView] = path.split('/');
      const valid = Object.keys(pageTitles) as AdminPage[];
      const page = requestedPage === 'integrations' ? 'providers' : requestedPage === 'logs' ? 'conversations' : requestedPage as AdminPage;
      const view = requestedPage === 'logs' ? 'logs' : requestedPage === 'conversations' && ['status', 'approvals', 'logs', 'statistics', 'memories'].includes(requestedView) ? requestedView as ConversationView : undefined;
      return { kind: 'admin', page: valid.includes(page) ? page : 'overview', view };
    }
    return { kind: 'home' };
  }
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return pathname === '/setup' ? { kind: 'setup' } : { kind: 'home' };
}

function go(path: string) {
  window.location.hash = path;
}

function prettyDate(value?: string | number, language: Language = 'zh') {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function parseTimestamp(value?: string) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function policyName(policies: PolicyRecord[], type: PolicyType, id?: string): string {
  return policies.find((item) => item.type === type && item.id === id)?.name ?? '';
}

const policyTypeNames: Record<PolicyType, string> = { dialog: '对话策略', voice: '语音策略', identity: '身份策略', memory: '记忆策略', cost: 'AI 费用策略' };

function StatusTag({ enabled }: { enabled: boolean }) {
  const { tr } = useI18n();
  return <Tag className={`status-tag ${enabled ? 'status-on' : 'status-off'}`} bordered={false}>{enabled ? tr('运行中') : tr('已停用')}</Tag>;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-mark${compact ? ' brand-mark-compact' : ''}`} aria-label="NoneBotMaker">
      <span className="brand-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
      {!compact && <span className="brand-wordmark">NONEBOT<span>MAKER</span></span>}
    </span>
  );
}

function ThemeSwitch() {
  const { mode, setMode } = useTheme();
  const { tr } = useI18n();
  return (
    <Segmented
      className="theme-switch"
      size="small"
      value={mode}
      onChange={(value) => setMode(value as ThemeMode)}
      options={[
        { value: 'light', icon: <SunOutlined />, tooltip: tr('亮色模式') },
        { value: 'dark', icon: <MoonOutlined />, tooltip: tr('暗色模式') },
        { value: 'system', icon: <DesktopOutlined />, tooltip: tr('跟随系统') },
      ]}
      aria-label={tr('界面主题')}
    />
  );
}

function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <a className="brand-link" href="#/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <nav className="landing-nav" aria-label="主导航">
          <a href="#features">平台能力</a>
          <a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer">源代码 <ArrowUpOutlined /></a>
          <ThemeSwitch />
          <Button type="primary" icon={<LoginOutlined />} href="#/login">管理员登录</Button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> SERVERLESS BOT STUDIO <span className="eyebrow-index">01 / 04</span></div>
          <h1>把机器人运行时，<br /><span>交还给你。</span></h1>
          <p className="hero-lead">在一个控制台中编排插件、平台账号与群聊策略。面向边缘环境构建，配置随部署运行。</p>
          <div className="hero-actions">
            <Button type="primary" size="large" icon={<LoginOutlined />} href="#/login">进入管理台</Button>
            <a className="text-link" href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> 查看开源项目 <ArrowRightOutlined /></a>
          </div>
          <div className="hero-meta">
            <div><span className="meta-label">RUNTIME</span><strong>EDGE / SERVERLESS</strong></div>
            <div><span className="meta-label">PLUGIN</span><strong>TYPESCRIPT FIRST</strong></div>
            <div><span className="meta-label">CONTROL</span><strong>SELF-HOSTED</strong></div>
          </div>
        </div>
        <div className="hero-visual" aria-label="机器人运行结构示意图">
          <div className="visual-topline"><span>RUNTIME MAP</span><span>NBM / 2026</span></div>
          <div className="runtime-map">
            <div className="map-node map-node-plugin"><CodeOutlined /><span>PLUGIN</span><small>chatbot / ts</small></div>
            <div className="map-link map-link-a"><i /></div>
            <div className="map-node map-node-account"><RobotOutlined /><span>ACCOUNT</span><small>multi-instance</small></div>
            <div className="map-link map-link-b"><i /></div>
            <div className="map-node map-node-group"><TeamOutlined /><span>GROUP</span><small>policy / model</small></div>
            <div className="map-orbit orbit-one" /><div className="map-orbit orbit-two" />
            <div className="map-core"><BrandMark compact /><span>CONTROL<br />PLANE</span></div>
          </div>
          <div className="visual-legend"><span><i className="legend-dot" /> CONFIGURED FLOW</span><span>01 PLUGIN → N ACCOUNTS → N GROUPS</span></div>
          <div className="visual-coordinate">36° 04′ 28″ N&nbsp;&nbsp; / &nbsp;&nbsp;118° 22′ 11″ E</div>
        </div>
      </section>

      <section className="landing-strip" id="features" aria-label="核心能力">
        <div className="strip-heading"><span>一个工作面</span><span>三层控制</span></div>
        <article><span className="feature-index">A / EXTENSION</span><CodeOutlined /><h2>插件可控</h2><p>插件、实例与群聊策略分层管理，启停状态一目了然。</p></article>
        <article><span className="feature-index">B / INTELLIGENCE</span><ThunderboltOutlined /><h2>模型可换</h2><p>为每个群聊选择供应商与模型，成本参数独立配置。</p></article>
        <article><span className="feature-index">C / EDGE</span><CloudServerOutlined /><h2>边缘部署</h2><p>围绕 Serverless 运行设计，让配置与运行环境保持贴近。</p></article>
        <div className="strip-footer"><span>OPEN SOURCE / TYPESCRIPT</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer">EXPLORE REPOSITORY <ArrowRightOutlined /></a></div>
      </section>
      <footer className="landing-footer"><BrandMark compact /><span>NONEBOTMAKER / SERVERLESS BOT STUDIO</span><span>BUILT FOR THE EDGE</span></footer>
    </main>
  );
}

function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [form] = Form.useForm<{ password: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (values: { password: string }) => {
    setBusy(true);
    setError('');
    try {
      await api.login(values.password);
      onSuccess();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <header className="login-header"><a className="brand-link" href="#/"><BrandMark /></a><div className="login-header-actions"><ThemeSwitch /><a href="#/" className="back-link">返回首页 <ArrowRightOutlined /></a></div></header>
      <div className="login-layout">
        <section className="login-context">
          <div className="eyebrow"><span className="eyebrow-line" /> AUTHENTICATED ACCESS <span className="eyebrow-index">ADMIN / 01</span></div>
          <h1>运行控制，<br /><span>从这里开始。</span></h1>
          <p>管理插件、机器人账号与群聊 AI 策略。所有配置通过服务端接口持久化。</p>
          <div className="login-seal"><SafetyCertificateOutlined /><span>仅授权管理员可访问</span><small>SESSION / HTTP-ONLY COOKIE</small></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <div className="panel-index">ACCESS TERMINAL <span>AUTH-01</span></div>
          <div className="login-icon"><LoginOutlined /></div>
          <Title level={2} id="login-title">管理员登录</Title>
          <Paragraph>输入管理员密码以继续。</Paragraph>
          {error && <Alert className="form-alert" type="error" showIcon message={error} />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: '请输入管理员密码' }]}>
              <Input.Password size="large" autoComplete="current-password" placeholder="输入管理员密码" />
            </Form.Item>
            <Button block type="primary" size="large" htmlType="submit" loading={busy} icon={<LoginOutlined />}>验证并进入</Button>
          </Form>
          <Button type="link" href="/setup" className="setup-entry">首次部署？初始化数据库</Button>
          <div className="login-footnote"><span className="online-dot" /> SESSION COOKIE ENCRYPTED <span>HTTPS 推荐</span></div>
        </section>
      </div>
      <footer className="login-footer"><span>NONEBOTMAKER / ADMIN CONSOLE</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> GITHUB</a></footer>
    </main>
  );
}

function SetupPage() {
  const { tr } = useI18n();
  const [form] = Form.useForm<{ token: string }>();
  const [defaultsForm] = Form.useForm<{ token: string }>();
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      setStatus(await api.setupStatus());
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async ({ token }: { token: string }) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.initializeDatabase(token));
      form.resetFields();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const fillDefaults = async ({ token }: { token: string }) => {
    setSeeding(true); setSeeded(false); setError('');
    try {
      const result = await api.seedDefaults(token);
      if (result.seeded) { setSeeded(true); defaultsForm.resetFields(); await refresh(); }
    } catch (reason) { setError(formatError(reason)); }
    finally { setSeeding(false); }
  };

  const ready = status?.schemaReady === true;
  const connected = status?.databaseConfigured === true;

  return (
    <main className="login-shell setup-shell">
      <header className="login-header">
        <a className="brand-link" href="/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <div className="login-header-actions"><ThemeSwitch /><a href="#/login" className="back-link">管理员登录 <ArrowRightOutlined /></a></div>
      </header>
      <div className="login-layout setup-layout">
        <section className="login-context">
          <div className="eyebrow"><span className="eyebrow-line" /> SYSTEM BOOTSTRAP <span className="eyebrow-index">SETUP / 00</span></div>
          <h1>初始化<br /><span>数据平面。</span></h1>
          <p>首次部署需要把基础表结构与迁移记录写入 D1。初始化脚本可重复执行，不会清空已有配置或对话数据。</p>
          <div className="setup-facts">
            <div><span>STORAGE</span><strong>D1 / SQLITE</strong></div>
            <div><span>TOKEN</span><strong>SYS_SECRET</strong></div>
            <div><span>EXECUTION</span><strong>IDEMPOTENT</strong></div>
          </div>
        </section>

        <section className="login-panel setup-panel" aria-labelledby="setup-title">
          <div className="panel-index">DATABASE BOOTSTRAP <span>SETUP-01</span></div>
          <div className="login-icon"><DatabaseOutlined /></div>
          <Title level={2} id="setup-title">数据库初始化</Title>
          <Paragraph>检查当前 D1 绑定并应用基础表结构。管理员密码由部署环境的 <code>SYS_PASSWD</code> 提供，不在此页面设置。</Paragraph>

          {error && <Alert className="form-alert" type="error" showIcon message={error} />}
          {checking && !status && <div className="setup-checking"><Spin size="small" /><span>正在检查数据库状态…</span></div>}

          {status && (
            <div className="setup-status">
              <div><span>D1 BINDING</span><Tag bordered={false} className={`setup-badge ${connected ? 'setup-badge-on' : 'setup-badge-off'}`}>{connected ? 'CONNECTED' : 'MISSING'}</Tag></div>
              <div><span>SCHEMA</span><Tag bordered={false} className={`setup-badge ${ready ? 'setup-badge-on' : 'setup-badge-wait'}`}>{ready ? 'READY' : 'PENDING'}</Tag></div>
              <div><span>MIGRATION LEDGER</span><strong>{status.pendingMigrations === 0 ? 'SYNCED' : `${status.pendingMigrations} PENDING`}</strong></div>
            </div>
          )}

          {status && !ready && status.missing.length > 0 && (
            <p className="setup-hint">待创建：{status.missing.join(' · ')}</p>
          )}

          {ready ? (
            <div className="setup-complete">
              <Alert type="success" showIcon message="数据库已就绪" description="基础表、对话日志表、chatbot 状态表与迁移记录均已写入。" />
              <Button block type="primary" size="large" href="#/login" icon={<LoginOutlined />}>前往管理员登录</Button>
            </div>
          ) : (
            <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
              <Form.Item
                name="token"
                label="SYS_SECRET"
                rules={[{ required: true, message: '请输入 SYS_SECRET' }]}
              >
                <Input.Password size="large" autoComplete="off" placeholder="输入部署时配置的 SYS_SECRET" disabled={!connected} />
              </Form.Item>
              <Button block type="primary" size="large" htmlType="submit" loading={busy} disabled={!connected} icon={<DatabaseOutlined />}>执行初始化</Button>
            </Form>
          )}
          <div className="setup-defaults">
            <h3>{tr('补齐默认配置')}</h3>
            <p>{tr('需要管理员显式输入 SYS_SECRET，仅补缺默认身份、对话、语音、记忆、费用、模型价格和内置工具；不会覆盖已有手工配置，也不会创建收费供应商。')}</p>
            {seeded && <Alert type="success" showIcon message={tr('默认配置已补齐')} />}
            <Form form={defaultsForm} layout="vertical" onFinish={fillDefaults}>
              <Form.Item name="token" label="SYS_SECRET" rules={[{ required: true, message: tr('请输入 SYS_SECRET') }]}><Input.Password autoComplete="off" placeholder={tr('输入部署时配置的 SYS_SECRET')} /></Form.Item>
              <Button block htmlType="submit" loading={seeding}>{tr('显式补齐默认配置')}</Button>
            </Form>
          </div>
          <div className="login-footnote"><span className="online-dot" /> DATABASE / D1 <span>REFRESH TO RECHECK</span></div>
        </section>
      </div>
      <footer className="login-footer"><span>NONEBOTMAKER / DATABASE BOOTSTRAP</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> GITHUB</a></footer>
    </main>
  );
}

function AdminConsole({ page, view = 'status', onLogout }: { page: AdminPage; view?: ConversationView; onLogout: () => void }) {
  const { message } = AntApp.useApp();
  const { language, setLanguage, tr } = useI18n();
  const { resolved } = useTheme();
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [accounts, setAccounts] = useState<BotAccountRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [prices, setPrices] = useState<ModelPriceRecord[]>([]);
  const [libraries, setLibraries] = useState<LibraryData>({ skills: [], mcps: [], rules: [] });
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [tools, setTools] = useState<LibraryRecord[]>([]);
  const [memories, setMemories] = useState<ProjectMemoryRecord[]>([]);
  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsEnabled, setLogsEnabled] = useState<boolean | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logFilters, setLogFilters] = useState<LogFilters>({});
  const [filterForm] = Form.useForm<LogFilters>();

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const handleError = useCallback((reason: unknown) => {
    const error = formatError(reason);
    setActionError(error);
    message.error(error);
  }, [message]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setActionError('');
    const load = async () => {
      try {
        switch (page) {
          case 'overview': {
            const [pluginData, accountData, groupData, providerData, policyData] = await Promise.all([
              api.listPlugins(), api.listAccounts(), api.listGroups(), api.listProviders(), api.listPolicies(),
            ]);
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData); setGroups(groupData); setProviders(providerData); setPolicies(policyData);
            break;
          }
          case 'plugins': setPlugins(await api.listPlugins()); break;
          case 'accounts': {
            const [pluginData, accountData] = await Promise.all([api.listPlugins(), api.listAccounts()]);
            const memoryData = await Promise.all(accountData.map((account) => api.listProjectMemories(account.id)));
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData); setMemories(memoryData.flat());
            break;
          }
          case 'groups': {
            const [groupData, accountData, pluginData, providerData, policyData, toolData] = await Promise.all([
              api.listGroups(), api.listAccounts(), api.listPlugins(), api.listProviders(), api.listPolicies(), api.listTools(),
            ]);
            if (!active) return;
            setGroups(groupData); setAccounts(accountData); setPlugins(pluginData); setProviders(providerData); setPolicies(policyData); setTools(toolData);
            break;
          }
          case 'conversations': {
            const [groupData, accountData] = await Promise.all([api.listGroups(), api.listAccounts()]);
            if (!active) return;
            setGroups(groupData); setAccounts(accountData);
            if (view !== 'logs') break;
            // Conversation records are read from the same endpoint as the legacy logs route.
            const result = await api.listLogs({ page: logPage, pageSize: 20, q: logFilters.q, pluginId: logFilters.pluginId,
              openid: logFilters.openid, accountId: logFilters.accountId, groupId: logFilters.groupId,
              from: parseTimestamp(logFilters.from), to: parseTimestamp(logFilters.to) });
            if (!active) return;
            setLogs(result.items); setLogsTotal(result.total); setLogsEnabled(result.enabled);
            setPlugins(await api.listPlugins());
            break;
          }
          case 'providers': setProviders(await api.listProviders()); break;
          case 'prices': setPrices(await api.listPrices()); break;
          case 'budgets': case 'dialogs': case 'voices': case 'memory-policies': case 'identities': {
            const [providerData, skillData, mcpData, ruleData, policyData, toolData] = await Promise.all([
              api.listProviders(), api.listLibraries('skills'), api.listLibraries('mcps'), api.listLibraries('rules'), api.listPolicies(), api.listTools(),
            ]);
            if (!active) return;
            setProviders(providerData); setLibraries({ skills: skillData, mcps: mcpData, rules: ruleData }); setPolicies(policyData); setTools(toolData);
            break;
          }
          case 'skills': case 'mcps': case 'rules': {
            setLibraries({ skills: await api.listLibraries('skills'), mcps: await api.listLibraries('mcps'), rules: await api.listLibraries('rules') });
            break;
          }
          case 'tools': {
            const [toolData, providerData, priceData] = await Promise.all([api.listTools(), api.listProviders(), api.listPrices()]);
            if (!active) return;
            setTools(toolData); setProviders(providerData); setPrices(priceData);
            break;
          }
        }
      } catch (reason) {
        if (active) setLoadError(formatError(reason));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [page, view, refreshKey, logPage, logFilters]);

  const navItems = [
    { key: 'overview', icon: <BookOutlined />, label: tr('运行总览') },
    { key: 'platform', icon: <CloudServerOutlined />, label: tr('运行平台'), children: [
      { key: 'plugins', icon: <CodeOutlined />, label: tr('插件管理') },
      { key: 'accounts', icon: <RobotOutlined />, label: tr('平台账号') },
      { key: 'groups', icon: <TeamOutlined />, label: tr('群聊管理') },
      { key: 'conversations', icon: <MessageOutlined />, label: tr('会话管理') },
    ] },
    { key: 'model', icon: <ApiOutlined />, label: tr('模型能力'), children: [
      { key: 'interfaces', label: tr('接口管理'), children: [
        { key: 'providers', label: tr('AI 供应商') }, { key: 'prices', label: tr('AI 模型价格') }, { key: 'budgets', label: tr('AI 费用策略') },
      ] },
      { key: 'strategies', label: tr('策略管理'), children: [
        { key: 'identities', label: tr('身份策略') }, { key: 'dialogs', label: tr('对话策略') },
        { key: 'voices', label: tr('语音策略') }, { key: 'memory-policies', label: tr('记忆策略') },
      ] },
      { key: 'capabilities', label: tr('能力管理'), children: [
        { key: 'skills', label: 'Skills' }, { key: 'mcps', label: 'MCP' }, { key: 'rules', label: 'Rules' }, { key: 'tools', label: tr('工具') },
      ] },
    ] },
  ];
  const [openMenus, setOpenMenus] = useState<string[]>(['platform', 'model', 'interfaces', 'strategies', 'capabilities']);
  const title = pageTitles[page];
  const setPage = (key: string) => {
    setMobileNav(false);
    go(`/admin/${key}`);
  };
  const logout = async () => {
    try { await api.logout(); } catch (reason) { handleError(reason); }
    onLogout();
  };

  return (
    <Layout className="admin-layout">
      <Sider className={`admin-sider${mobileNav ? ' admin-sider-open' : ''}`} width={252} theme={resolved === 'dark' ? 'dark' : 'light'} aria-label={tr('管理台导航')}>
        <a className="sider-brand" href="#/admin/overview"><BrandMark /></a>
        <div className="workspace-label"><span className="workspace-dot" /> LOCAL CONTROL PLANE</div>
        <Menu mode="inline" selectedKeys={[page]} openKeys={openMenus} onOpenChange={setOpenMenus} items={navItems} onClick={({ key }) => setPage(key)} className="admin-menu" />
        <div className="sider-bottom">
          <div className="sider-status"><span className="online-dot" /><span>{tr('管理会话已验证')}</span><span className="sider-status-meta">SECURE</span></div>
          <button type="button" className="logout-button" onClick={() => void logout()}><LogoutOutlined /> {tr('退出管理台')}</button>
          <div className="sider-version"><span>NONEBOTMAKER</span><span>CONSOLE / 0.2</span></div>
        </div>
      </Sider>
      {mobileNav && <button type="button" aria-label={tr('关闭导航')} className="nav-backdrop" onClick={() => setMobileNav(false)} />}
      <Layout className="admin-main-layout">
        <header className="admin-topbar">
          <button type="button" aria-label={tr('打开导航菜单')} className="mobile-menu-button" onClick={() => setMobileNav(true)}><MenuFoldOutlined /></button>
          <div className="breadcrumbs"><span>CONTROL PLANE</span><span>/</span><strong>{tr(title.title)}</strong></div>
          <div className="topbar-right">
            <ThemeSwitch />
            <Segmented
              className="language-switch"
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as Language)}
              options={[{ label: '中', value: 'zh' }, { label: 'EN', value: 'en' }]}
              aria-label={tr('选择语言')}
            />
            <span className="topbar-health"><i /> API SESSION ACTIVE</span>
            <Tooltip title={tr('刷新当前数据')}><Button type="text" aria-label={tr('刷新当前数据')} icon={<ReloadOutlined />} onClick={refresh} /></Tooltip>
            <a href="#/" className="topbar-home">{tr('公开首页')} <ArrowRightOutlined /></a>
          </div>
        </header>
        <Content className="admin-content">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {title.eyebrow}</div><Title level={1}>{tr(title.title)}</Title><Paragraph>{tr(title.description)}</Paragraph></div>
            <div className="page-heading-actions"><span className="sync-stamp">LAST REQUEST<br /><b>LIVE API DATA</b></span></div>
          </div>
          {actionError && <Alert className="action-alert" type="error" showIcon closable onClose={() => setActionError('')} message={actionError} />}
          {loading ? <div className="page-loading" role="status" aria-label={tr('正在读取服务端配置…')}><span>{tr('正在读取服务端配置…')}</span><div className="page-skeleton"><Skeleton active title paragraph={{ rows: 3 }} /><Skeleton active title paragraph={{ rows: 2 }} /></div></div> : loadError ? (
            <div className="page-error"><Alert type="error" showIcon message={tr('无法读取此页面数据')} description={loadError} action={<Button size="small" icon={<ReloadOutlined />} onClick={refresh}>{tr('重试')}</Button>} /></div>
          ) : (
            <>
              {page === 'overview' && <OverviewPage plugins={plugins} accounts={accounts} groups={groups} providers={providers} policies={policies} onNavigate={setPage} />}
              {page === 'plugins' && <PluginsPage data={plugins} onRefresh={refresh} onError={handleError} />}
              {page === 'accounts' && <><AccountsPage plugins={plugins} data={accounts} onRefresh={refresh} onError={handleError} /><div className="account-memory-section"><h2>{tr('账号共享项目记忆')}</h2><p>{tr('共享项目记忆按平台账号存储，不等同于会话记忆策略。')}</p><ProjectMemoriesPanel data={memories} accounts={accounts} onRefresh={refresh} onError={handleError} /></div></>}
              {page === 'groups' && <GroupsPage groups={groups} plugins={plugins} accounts={accounts} providers={providers} policies={policies} tools={tools} onRefresh={refresh} onError={handleError} />}
              {page === 'conversations' && <section className="conversation-workspace"><Tabs activeKey={view} onChange={(key) => go(`/admin/conversations/${key}`)} items={[
                { key: 'status', label: tr('运行状态'), children: view === 'status' && <ChatbotRuntimePage groups={groups} accounts={accounts} onError={handleError} onNavigate={setPage} onRefresh={refresh} view="status" /> },
                { key: 'approvals', label: tr('操作审批'), children: view === 'approvals' && <ChatbotRuntimePage groups={groups} accounts={accounts} onError={handleError} onNavigate={setPage} onRefresh={refresh} view="approvals" /> },
                { key: 'logs', label: tr('聊天记录'), children: <LogsPage data={logs} total={logsTotal} enabled={logsEnabled} plugins={plugins} accounts={accounts} groups={groups} page={logPage} onPage={setLogPage} form={filterForm} onFilter={(values) => { setLogPage(1); setLogFilters(values); }} onCleared={() => { setLogPage(1); refresh(); }} /> },
                { key: 'statistics', label: tr('统计'), children: view === 'statistics' && <ConversationStatistics groups={groups} accounts={accounts} /> },
                { key: 'memories', label: tr('会话记忆'), children: view === 'memories' && <ConversationMemories groups={groups} accounts={accounts} /> },
              ]} /></section>}
              {page === 'providers' && <ProvidersPanel data={providers} onRefresh={refresh} onError={handleError} />}
              {page === 'prices' && <PricesPanel data={prices} onRefresh={refresh} onError={handleError} />}
              {page === 'identities' && <PolicyPanel type="identity" data={policies} providers={providers} libraries={libraries} tools={tools} onRefresh={refresh} onError={handleError} />}
              {page === 'dialogs' && <PolicyPanel type="dialog" data={policies} providers={providers} libraries={libraries} onRefresh={refresh} onError={handleError} />}
              {page === 'voices' && <PolicyPanel type="voice" data={policies} providers={providers} libraries={libraries} onRefresh={refresh} onError={handleError} />}
              {(page === 'budgets' || page === 'memory-policies') && <PolicyPanel type={page === 'budgets' ? 'cost' : 'memory'} data={policies} providers={providers} libraries={libraries} onRefresh={refresh} onError={handleError} />}
              {(page === 'skills' || page === 'mcps' || page === 'rules') && <LibraryPanel kind={page} data={libraries[page]} onRefresh={refresh} onError={handleError} />}
              {page === 'tools' && <ToolsPanel data={tools} providers={providers} prices={prices} onRefresh={refresh} onError={handleError} />}
            </>
          )}
          <footer className="content-footer"><span>EDGE CONFIGURATION / NONEBOTMAKER</span><span>SESSION ISOLATED <i /></span></footer>
        </Content>
      </Layout>
    </Layout>
  );
}

function ConversationStatistics({ groups, accounts }: { groups: GroupRecord[]; accounts: BotAccountRecord[] }) {
  const { tr, language } = useI18n();
  const [selectedKey, setSelectedKey] = useState('');
  const [stats, setStats] = useState<{ key: string; value: ChatbotConversationStats } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const targets = groups.flatMap((group) => conversationIdList(group.externalId).map((externalId) => ({ group, externalId, key: JSON.stringify([group.id, externalId]) })));
  const target = targets.find((item) => item.key === selectedKey);
  const group = target?.group;
  const externalId = target?.externalId;
  useEffect(() => {
    if (!targets.some((item) => item.key === selectedKey)) setSelectedKey(targets[0]?.key ?? '');
  }, [groups, selectedKey]);
  useEffect(() => {
    if (!group || !externalId) { setStats(null); return; }
    let active = true;
    setLoading(true); setStats(null); setError('');
    api.getChatbotConversationStats(group.accountId, group.id, externalId)
      .then((result) => { if (active) setStats({ key: selectedKey, value: result }); })
      .catch((reason) => { if (active) setError(formatError(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [group?.id, group?.accountId, externalId, selectedKey, refreshKey]);
  const currentStats = stats?.key === selectedKey ? stats.value : null;
  const number = (value: number) => new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN').format(value);
  return <section className="conversation-statistics">
    <div className="memory-target-row"><Select className="full-width" value={selectedKey || undefined} onChange={setSelectedKey} placeholder={tr('选择会话')} options={targets.map(({ group: item, externalId: id, key }) => ({ value: key, label: `${accounts.find((account) => account.id === item.accountId)?.name ?? item.accountId} · ${item.name || id} · ${id}` }))} /><Button icon={<ReloadOutlined />} loading={loading} disabled={!target} onClick={() => setRefreshKey((value) => value + 1)}>{tr('刷新')}</Button></div>
    {!target && <Alert type="info" showIcon message={tr('没有可管理会话，请先绑定群聊或私聊。')} />}
    {loading && <div role="status"><Spin size="small" /> {tr('正在读取会话统计…')}</div>}
    {error && <Alert type="error" showIcon message={tr('会话统计读取失败')} description={error} />}
    {currentStats?.enabled === false && <Alert type="info" showIcon message={tr('对话日志已关闭，当前无法提供会话统计。')} description={tr('服务端 LOG_RECORD 未开启；请勿将未记录的费用视为零。')} />}
    {currentStats?.enabled && <>
      <Alert type={currentStats.truncated ? 'warning' : 'info'} showIcon message={currentStats.truncated ? tr('部分统计：存在更早的日志未扫描') : tr('基于当前保留日志的会话统计')} description={`${tr('按账号与群绑定扫描最近最多 1000 条原始日志，仅计入当前所选 OpenID；实际范围受日志保留影响，不代表全量账单。')} ${tr('已扫描原始记录')}：${number(currentStats.scanned)}`} />
      <div className="runtime-status-grid">
        <div><span>{tr('收到消息')}</span><strong>{number(currentStats.messagesIn)}</strong></div>
        <div><span>{tr('发出回复')}</span><strong>{number(currentStats.repliesOut)}</strong></div>
        <div><span>{tr('错误记录')}</span><strong>{number(currentStats.errors)}</strong></div>
        <div><span>{tr('日志内费用（USD）')}</span><strong>${currentStats.costUsd.toFixed(8)}</strong></div>
        <div><span>{tr('计费记录数')}</span><strong>{number(currentStats.charges)}</strong></div>
      </div>
    </>}
  </section>;
}

function ConversationMemories({ groups, accounts }: { groups: GroupRecord[]; accounts: BotAccountRecord[] }) {
  const { tr, language } = useI18n();
  const { message } = AntApp.useApp();
  const drawer = useDrawer();
  const [form] = Form.useForm<ConversationMemoryInput>();
  const [selectedKey, setSelectedKey] = useState('');
  const [items, setItems] = useState<ConversationMemoryItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const targets = groups.flatMap((group) => conversationIdList(group.externalId).map((externalId) => ({ group, externalId, key: JSON.stringify([group.id, externalId]) })));
  const target = targets.find((item) => item.key === selectedKey);
  const group = target?.group;
  const externalId = target?.externalId;
  useEffect(() => {
    if (!targets.some((item) => item.key === selectedKey)) setSelectedKey(targets[0]?.key ?? '');
  }, [groups, selectedKey]);
  useEffect(() => {
    if (!group || !externalId) { setItems([]); return; }
    let active = true;
    setLoading(true); setError('');
    api.listConversationMemories(group.accountId, group.id, externalId).then((data) => { if (active) setItems(data); })
      .catch((reason) => { if (active) { setItems([]); setError(formatError(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [group?.id, group?.accountId, externalId, refreshKey]);
  const editing = items.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', title: editing?.title ?? '', description: editing?.description ?? '', content: editing?.content ?? '', type: editing?.type ?? 'reference', status: editing?.status ?? 'confirmed' });
  }, [drawer.open, editing, form]);
  const save = async (values: ConversationMemoryInput) => {
    if (!group || !externalId) return;
    setBusy(true);
    try {
      await api.saveConversationMemory(group.accountId, group.id, externalId, values, editing?.name);
      drawer.close(); setRefreshKey((value) => value + 1); message.success(tr('保存成功'));
    } catch (reason) { setError(formatError(reason)); }
    finally { setBusy(false); }
  };
  const act = async (action: 'approve' | 'delete', item: ConversationMemoryItem) => {
    if (!group || !externalId) return;
    setBusy(true);
    try {
      if (action === 'approve') await api.approveConversationMemory(group.accountId, group.id, externalId, item.name);
      else await api.deleteConversationMemory(group.accountId, group.id, externalId, item.name);
      setRefreshKey((value) => value + 1);
    } catch (reason) { setError(formatError(reason)); }
    finally { setBusy(false); }
  };
  const columns: TableColumnsType<ConversationMemoryItem> = [
    { title: tr('标题'), dataIndex: 'title', key: 'title', ellipsis: true },
    { title: tr('记忆名称'), dataIndex: 'name', key: 'name', ellipsis: true },
    { title: tr('说明'), dataIndex: 'description', key: 'description', ellipsis: true, render: (value: string) => value || '—' },
    { title: tr('类型'), dataIndex: 'type', key: 'type', render: (type: MemoryType) => tr(({ user: '用户偏好', feedback: '反馈', project: '项目', reference: '参考资料' } as Record<MemoryType, string>)[type]) },
    { title: tr('状态'), dataIndex: 'status', key: 'status', render: (status: string) => <Tag color={status === 'pending' ? 'warning' : 'success'}>{tr(status === 'pending' ? '待审核' : '已确认')}</Tag> },
    { title: tr('到期时间'), dataIndex: 'expiresAt', key: 'expiresAt', render: (value: number) => prettyDate(value, language) },
    { title: tr('操作'), key: 'action', render: (_, item) => <Space wrap><Button size="small" disabled={busy} onClick={() => drawer.edit(item.id)}>{tr('编辑')}</Button>{item.status === 'pending' && <Popconfirm title={tr('确认此条会话记忆并允许进入模型上下文？')} onConfirm={() => void act('approve', item)}><Button size="small" disabled={busy}>{tr('确认记忆')}</Button></Popconfirm>}<Popconfirm title={tr('确定永久删除此条会话记忆？')} okText={tr('删除')} okButtonProps={{ danger: true }} onConfirm={() => void act('delete', item)}><Button size="small" danger disabled={busy}>{tr('删除')}</Button></Popconfirm></Space> },
  ];
  return <section className="conversation-memories">
    <div className="memory-target-row"><Select className="full-width" value={selectedKey || undefined} onChange={(key) => { drawer.close(); setSelectedKey(key); }} placeholder={tr('选择会话')} options={targets.map(({ group: item, externalId: id, key }) => ({ value: key, label: `${accounts.find((account) => account.id === item.accountId)?.name ?? item.accountId} · ${item.name || id} · ${id}` }))} /><Button onClick={() => setRefreshKey((value) => value + 1)} icon={<ReloadOutlined />}>{tr('刷新')}</Button></div>
    {!target && <Alert type="info" showIcon message={tr('没有可管理会话，请先绑定群聊或私聊。')} />}
    {group && !group.memoryPolicyId && <Alert type="info" showIcon message={tr('此会话未选择记忆策略；请在群聊管理选择后再管理条目。')} />}
    {error && <Alert type="warning" showIcon message={tr('会话记忆读取或操作失败')} description={error} />}
    {group && <><div className="memory-list-toolbar"><span>{tr('会话记忆')} · {items.length}</span><Button type="primary" icon={<PlusOutlined />} disabled={!group.memoryPolicyId || loading || Boolean(error)} onClick={() => drawer.edit()}>{tr('新增会话记忆')}</Button></div>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} scroll={{ x: 850 }} className="data-table" locale={{ emptyText: tr('当前会话没有记忆条目') }} expandable={{ expandedRowRender: (item) => <div className="log-details"><p>{tr('记忆内容')}</p><DetailValue value={item.content} /></div> }} />
      <Drawer title={<DrawerTitle label="CONVERSATION MEMORY" title={editing ? tr('编辑会话记忆') : tr('新增会话记忆')} />} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={busy} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="name" label={tr('记忆名称')} extra={tr('1–64 位小写英文、数字、下划线或连字符，首位必须是字母或数字。')} rules={[{ required: true }, { pattern: /^[a-z0-9][a-z0-9_-]{0,63}$/, message: tr('记忆名称格式无效') }]}><Input maxLength={64} disabled={Boolean(editing)} /></Form.Item>
          <Form.Item name="title" label={tr('标题')} rules={[{ required: true }, { max: 120 }, { pattern: /^[^\r\n]*$/, message: tr('标题不能换行') }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="description" label={tr('说明')} rules={[{ max: 500 }, { pattern: /^[^\r\n]*$/, message: tr('说明不能换行') }]}><Input maxLength={500} showCount /></Form.Item>
          <Form.Item name="type" label={tr('类型')}><Select options={(['user', 'feedback', 'project', 'reference'] as MemoryType[]).map((value) => ({ value, label: tr(({ user: '用户偏好', feedback: '反馈', project: '项目', reference: '参考资料' } as Record<MemoryType, string>)[value]) }))} /></Form.Item>
          <Form.Item name="status" label={tr('状态')}><Select options={[{ value: 'pending', label: tr('待审核') }, { value: 'confirmed', label: tr('已确认') }]} /></Form.Item>
          <Form.Item name="content" label={tr('记忆内容')} rules={[{ required: true }, { max: 20000 }]}><Input.TextArea rows={8} showCount maxLength={20000} /></Form.Item>
        </Form>
      </Drawer>
    </>}
  </section>;
}

function ToolsPanel({ data, providers, prices, onRefresh, onError }: { data: LibraryRecord[]; providers: ProviderRecord[]; prices: ModelPriceRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const kind = Form.useWatch(['config', 'kind'], { form, preserve: true }) as string | undefined;
  const providerId = Form.useWatch(['config', 'providerId'], { form, preserve: true }) as string | undefined;
  const imageModel = Form.useWatch(['config', 'model'], { form, preserve: true }) as string | undefined;
  const builtinName = editing?.config.kind === 'builtin' ? String(editing.config.name ?? '') : 'chat_generate_image';
  const isImageTool = kind === 'builtin' && builtinName === 'chat_generate_image';
  const supportsExtendedImageQuality = /^gpt-image-2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(imageModel ?? '');
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', description: editing?.description ?? '', enabled: editing?.enabled ?? false,
      config: { kind: 'https', name: '', method: 'POST', readOnly: false, url: '', providerId: '', model: '', size: '1024x1024', quality: 'low', fallbackCostPerImage: 0,
        ...editing?.config, authToken: '', parameterSchemaText: JSON.stringify(editing?.config.parameterSchema ?? {}, null, 2) },
    });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; description?: string; enabled: boolean; config: JsonObject }) => {
    let schema: unknown = editing?.config.parameterSchema ?? {};
    if (values.config.kind === 'https') {
      try { schema = JSON.parse(String(values.config.parameterSchemaText || '{}')); }
      catch { onError(new Error(tr('参数 Schema 必须是有效 JSON'))); return; }
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { onError(new Error(tr('参数 Schema 必须是 JSON 对象'))); return; }
    }
    const { parameterSchemaText: _, ...config } = values.config;
    if (!config.authToken) delete config.authToken;
    if (config.kind === 'builtin') config.name = builtinName;
    if (isImageTool && values.enabled && (!config.providerId || !config.model || !Number(config.fallbackCostPerImage))) {
      onError(new Error(tr('启用生图工具前必须选供应商、模型并设置每张兜底价'))); return;
    }
    setSaving(true);
    try {
      await api.saveTool({ name: values.name, description: values.description ?? '', enabled: values.enabled, config: { ...config, parameterSchema: schema } }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<LibraryRecord> = [
    { title: tr('名称'), dataIndex: 'name', key: 'name' },
    { title: tr('类型'), key: 'kind', render: (_, item) => item.config.kind === 'builtin' ? item.config.name === 'chat_generate_image' ? tr('内置生图') : tr('内置工具') : tr('自定义 HTTPS JSON API') },
    { title: tr('接口地址 / 模型'), key: 'target', render: (_, item) => <span className="table-mono">{String(item.config.kind === 'builtin' ? item.config.name === 'chat_generate_image' ? item.config.model || tr('未配置') : item.config.name ?? '—' : item.config.url ?? '—')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('操作'), key: 'actions', render: (_, item) => <Space><Button size="small" onClick={() => drawer.edit(item.id)}>{tr('编辑')}</Button>{item.config.kind !== 'builtin' && <Popconfirm title={`${tr('删除')}“${item.name}”？`} onConfirm={() => void api.deleteTool(item.id).then(onRefresh).catch(onError)}><Button danger size="small">{tr('删除')}</Button></Popconfirm>}</Space> },
  ];
  return <section className="data-page"><PageToolbar count={data.length} noun="TOOLS" action={tr('新增工具')} onCreate={() => drawer.edit()} />
    <Alert type="info" showIcon message={tr('工具先在目录配置，再在身份策略授权；群聊只能收紧审批或禁用。')} />
    {data.length ? <Table rowKey="id" className="data-table" dataSource={data} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} /> : <EmptyTable title={tr('还没有工具')} description={tr('预置生图工具默认关闭；添加工具后仍需在身份策略授权。')} onCreate={() => drawer.edit()} />}
    <Drawer width={640} title={<DrawerTitle label="TOOL CATALOG" title={editing ? tr('编辑工具') : tr('新增工具')} />} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存工具')}</Button></div>}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="description" label={tr('说明')}><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name={['config', 'kind']} label={tr('工具类型')}><Select disabled={Boolean(editing)} options={[{ value: 'https', label: tr('自定义 HTTPS JSON API') }, { value: 'builtin', label: tr('内置生图') }]} /></Form.Item>
        {kind === 'https' ? <>
          <Form.Item name={['config', 'name']} label={tr('工具函数名')} rules={[{ required: true, pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: tr('函数名只能使用英文、数字与下划线') }]}><Input placeholder="my_tool" /></Form.Item>
          <Form.Item name={['config', 'url']} label="HTTPS URL" rules={[{ required: true }, { type: 'url' }, { pattern: /^https:\/\//i, message: tr('只允许 HTTPS 地址') }]}><Input placeholder="https://api.example.com/tools" /></Form.Item>
          <div className="form-grid two-cols"><Form.Item name={['config', 'method']} label="HTTP Method"><Select onChange={(method: string) => form.setFieldValue(['config', 'readOnly'], method === 'GET')} options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]} /></Form.Item>
          <Form.Item name={['config', 'readOnly']} label={tr('只读工具')} valuePropName="checked"><Switch disabled /></Form.Item></div>
          <Form.Item name={['config', 'authToken']} label={tr('访问令牌')} extra={tr('留空保留已存令牌；保存后不会显示明文。')}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name={['config', 'parameterSchemaText']} label={tr('参数 Schema JSON')}><Input.TextArea rows={5} spellCheck={false} /></Form.Item>
          <Alert type="warning" showIcon message={tr('目标 URL 的内网地址、重定向和非 JSON 响应由服务端拒绝；请勿将密钥写在 URL 中。')} />
        </> : isImageTool ? <>
          <Alert type="info" showIcon message={tr('生图工具默认关闭，启用前必须配置真实供应商、图像模型与每张兜底价。')} />
          <Form.Item name={['config', 'providerId']} label={tr('AI 供应商')} rules={[{ required: true, message: tr('请选择AI供应商') }]}><Select options={providers.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          <Form.Item name={['config', 'model']} label={tr('图像模型')} rules={[{ required: true, message: tr('请选择模型') }]}><Select showSearch onChange={(model: string) => { if (!/^gpt-image-2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(model) && ['xhigh', 'max'].includes(String(form.getFieldValue(['config', 'quality'])))) form.setFieldValue(['config', 'quality'], 'low'); }} options={prices.filter((item) => item.enabled && (providers.find((provider) => provider.id === providerId)?.models.includes(item.model) ?? true)).map((item) => ({ value: item.model, label: item.model }))} /></Form.Item>
          <div className="form-grid two-cols"><Form.Item name={['config', 'size']} label={tr('尺寸')}><Select options={['1024x1024', '1536x1024', '1024x1536'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name={['config', 'quality']} label={tr('质量')}><Select options={['low', 'medium', 'high', ...(supportsExtendedImageQuality ? ['xhigh', 'max'] : [])].map((value) => ({ value, label: value }))} /></Form.Item></div>
          <Form.Item name={['config', 'fallbackCostPerImage']} label={tr('每张兜底价（USD）')} extra={tr('接口不返回可计费用量时按此价计费；启用前必须大于 0。')}><InputNumber min={0} precision={4} addonBefore="$" className="full-width" /></Form.Item>
        </> : <Alert type="info" showIcon message={`${tr('内置工具函数')}：${builtinName}`} description={tr('此函数名不可改动；只在身份策略授权后才可用于聊天。')} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function OverviewPage({ plugins, accounts, groups, providers, policies, onNavigate }: {
  plugins: PluginRecord[]; accounts: BotAccountRecord[]; groups: GroupRecord[]; providers: ProviderRecord[]; policies: PolicyRecord[]; onNavigate: (page: string) => void;
}) {
  const { tr } = useI18n();
  const activeAccounts = accounts.filter((item) => item.enabled).length;
  const activeGroups = groups.filter((item) => item.enabled).length;
  const activePlugins = plugins.filter((item) => item.enabled).length;
  const steps = [
    { index: '01', title: tr('配置 AI 供应商'), detail: tr('填写兼容 API 地址、密钥和模型；常用单价可一键导入。'), done: providers.some((item) => item.enabled), page: 'providers' },
    { index: '02', title: tr('创建身份策略'), detail: tr('选择模型、写人设与基础规则，在身份中授权 Skills/MCP/Rules。'), done: policies.some((item) => item.type === 'identity' && item.enabled), page: 'identities' },
    { index: '03', title: tr('添加平台账号'), detail: tr('把机器人 AppID 与密钥绑定到插件。'), done: accounts.length > 0, page: 'accounts' },
    { index: '04', title: tr('绑定群聊策略'), detail: tr('填写群 openid，选择身份策略和限额。'), done: groups.length > 0, page: 'groups' },
    { index: '05', title: tr('验证会话与日志'), detail: tr('在群里 @ 机器人，检查连接状态和对话日志。'), done: false, page: 'conversations' },
  ];
  return (
    <div className="overview-page">
      <section className="overview-banner">
        <div><span className="banner-label"><span className="online-dot" /> CONFIGURATION PLANE / ONLINE</span><h2>{tr('按顺序配置，跑通第一条消息。')}</h2><p>{tr('先配置供应商和身份、对话策略，再建账号并为群聊选择策略。')}</p></div>
        <div className="banner-code"><span>ENVIRONMENT</span><strong>EDGE / SERVERLESS</strong><span>CONFIG ORDER</span><strong>AI → PLUGIN → ACCOUNT → GROUP</strong></div>
      </section>
      <div className="metric-grid">
        <MetricTile index="01" label={tr('启用插件')} value={activePlugins} total={plugins.length} icon={<CodeOutlined />} onClick={() => onNavigate('plugins')} />
        <MetricTile index="02" label={tr('运行账号')} value={activeAccounts} total={accounts.length} icon={<RobotOutlined />} onClick={() => onNavigate('accounts')} />
        <MetricTile index="03" label={tr('启用群聊')} value={activeGroups} total={groups.length} icon={<TeamOutlined />} onClick={() => onNavigate('groups')} />
        <MetricTile index="04" label={tr('AI供应商')} value={providers.filter((item) => item.enabled).length} total={providers.length} icon={<ApiOutlined />} onClick={() => onNavigate('providers')} />
      </div>
      <div className="overview-status-links">
        <button type="button" onClick={() => onNavigate('conversations')}><MessageOutlined /><strong>{tr('连接与待审批')}</strong><small>{tr('到会话管理查看实时状态')}</small><ArrowRightOutlined /></button>
        <button type="button" onClick={() => onNavigate('budgets')}><DatabaseOutlined /><strong>{tr('费用策略覆盖')}</strong><small>{groups.filter((item) => item.costPolicyId).length} / {groups.length} {tr('个绑定已选费用策略；实际花费见聊天记录')}</small><ArrowRightOutlined /></button>
        <button type="button" onClick={() => go('/admin/conversations/logs')}><ExclamationCircleOutlined /><strong>{tr('异常与成本')}</strong><small>{tr('到聊天记录筛查错误与费用明细')}</small><ArrowRightOutlined /></button>
      </div>
      <Card className="section-card setup-guide" title={<SectionTitle index="00" title={tr('从零配置')} subtitle="SETUP ORDER" />}>
        <div className="setup-steps">{steps.map((step) => <button type="button" key={step.index} className={`setup-step${step.done ? ' is-done' : ''}`} onClick={() => onNavigate(step.page)}>
          <span className="setup-step-index">{step.done ? <CheckCircleOutlined /> : step.index}</span>
          <strong>{step.title}</strong>
          <small>{step.detail}</small>
          <em>{step.done ? tr('已完成') : step.page === 'conversations' ? tr('去检查') : tr('去配置')} <ArrowRightOutlined /></em>
        </button>)}</div>
      </Card>
      <div className="overview-columns">
        <Card className="section-card overview-flow" title={<SectionTitle index="A" title={tr('运行拓扑')} subtitle="RUNTIME GRAPH" />} extra={<Button type="link" onClick={() => onNavigate('groups')}>{tr('管理群聊')} <ArrowRightOutlined /></Button>}>
          <div className="flow-row"><span className="flow-icon"><CodeOutlined /></span><div><strong>{tr('插件')}</strong><small>{tr('逻辑与接入协议')}</small></div><b>{plugins.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><RobotOutlined /></span><div><strong>{tr('账号')}</strong><small>{tr('平台机器人实例')}</small></div><b>{accounts.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><TeamOutlined /></span><div><strong>{tr('群聊')}</strong><small>{tr('引用策略并按群运行')}</small></div><b>{groups.length.toString().padStart(2, '0')}</b></div>
          <div className="flow-caption"><span>PLUGIN</span><i /><span>MULTI-ACCOUNT</span><i /><span>GROUP POLICY</span></div>
        </Card>
        <Card className="section-card overview-quick config-rules-card" title={<SectionTitle index="B" title={tr('配置原则')} subtitle="CONFIG RULES" />}>
          <div className="config-rules">
            <div className="config-rule"><span>01</span><div><strong>{tr('策略复用')}</strong><small>{tr('模型、提示词和工具放在身份策略里，群聊只做选择与覆盖。')}</small></div></div>
            <div className="config-rule"><span>02</span><div><strong>{tr('留空继承')}</strong><small>{tr('群聊里的覆盖项留空时，自动使用身份策略或插件默认值。')}</small></div></div>
            <div className="config-rule"><span>03</span><div><strong>{tr('保存生效')}</strong><small>{tr('保存后下一条消息使用新配置，历史记录不会被重写。')}</small></div></div>
          </div>
        </Card>
      </div>
      <div className="overview-bottom"><span><CheckCircleOutlined /> SERVICE DATA</span><strong>{tr('配置来源为管理 REST API，不提供演示数据回退。')}</strong><span>LOG RETENTION / 30 DAYS</span></div>
    </div>
  );
}

function MetricTile({ index, label, value, total, icon, onClick }: { index: string; label: string; value: number; total: number; icon: React.ReactNode; onClick: () => void }) {
  const { tr } = useI18n();
  return <button className="metric-tile" onClick={onClick}><div className="metric-top"><span>{index} / {label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{String(value).padStart(2, '0')}<small> / {String(total).padStart(2, '0')}</small></div><div className="metric-bottom"><span>{tr('已启用 / 总数')}</span><ArrowRightOutlined /></div></button>;
}

function SectionTitle({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="section-title"><span>{index}</span><div><strong>{title}</strong><small>{subtitle}</small></div></div>;
}

function PageToolbar({ count, noun, action, onCreate }: { count: number; noun: string; action: string; onCreate: () => void }) {
  return <div className="page-toolbar"><span>RECORDS <b>{String(count).padStart(2, '0')}</b> / {noun}</span><Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>{action}</Button></div>;
}

function EmptyTable({ title, description, onCreate, action }: { title: string; description: string; onCreate?: () => void; action?: string }) {
  const { tr } = useI18n();
  return <div className="empty-state"><div className="empty-index">NO RECORD / 000</div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span><b>{title}</b><br />{description}</span>} />{onCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>{action ?? tr('创建第一条')}</Button>}</div>;
}

function useDrawer() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const edit = (id?: string) => { setEditingId(id); setOpen(true); };
  const close = () => setOpen(false);
  return { open, editingId, edit, close };
}

function PluginFieldInput({ field, editing = false, id, value, checked, onChange }: {
  field: PluginFieldDefinition;
  editing?: boolean;
  id?: string;
  value?: string | number;
  checked?: boolean;
  onChange?: (...args: unknown[]) => void;
}) {
  const { tr, localized } = useI18n();
  const placeholder = field.placeholder ? localized(field.placeholder) : undefined;
  if (field.options) {
    return <Select id={id} value={value as string | undefined} onChange={onChange} placeholder={placeholder} options={field.options.map((option) => ({ value: option.value, label: localized(option.label) }))} />;
  }
  if (field.type === 'boolean') {
    return <Switch id={id} checked={checked} onChange={onChange} checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} />;
  }
  if (field.type === 'number') {
    return <InputNumber id={id} value={value as number | undefined} onChange={onChange} className="full-width" min={field.min} max={field.max} step={field.step} placeholder={placeholder} />;
  }
  if (field.secret) {
    return <Input.Password id={id} value={value as string | undefined} onChange={onChange} autoComplete="new-password" placeholder={editing ? tr('留空保持现有值') : placeholder} />;
  }
  if (field.multiline) {
    return <Input.TextArea id={id} value={value as string | undefined} onChange={onChange} rows={3} placeholder={placeholder} />;
  }
  return <Input id={id} value={value as string | undefined} onChange={onChange} placeholder={placeholder} />;
}

function PluginField({ field, path, editing = false }: { field: PluginFieldDefinition; path: Array<string | number>; editing?: boolean }) {
  const { tr, localized } = useI18n();
  return (
    <Form.Item
      name={path}
      label={localized(field.label)}
      extra={localized(field.description)}
      valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
      rules={field.required && !(editing && field.secret) ? [{ required: true, message: tr('此字段为必填项') }] : undefined}
    >
      <PluginFieldInput field={field} editing={editing} />
    </Form.Item>
  );
}

function SchemaFields({ fields, path, editing = false }: { fields: PluginFieldDefinition[]; path: string; editing?: boolean }) {
  const { tr, localized } = useI18n();
  const sections = new Map<string, PluginFieldDefinition[]>();
  for (const field of fields) {
    const label = field.group ? localized(field.group) : tr('其他');
    sections.set(label, [...(sections.get(label) ?? []), field]);
  }
  return <div className="schema-fields">{[...sections].map(([label, items]) => <section key={label} className="schema-section"><div className="form-section-heading"><span>{label}</span><small>{items.length} FIELDS</small></div>{items.map((field) => <PluginField key={field.key} field={field} path={[path, field.key]} editing={editing} />)}</section>)}</div>;
}

function editableFieldValues(fields: PluginFieldDefinition[], previous: JsonObject = {}) {
  const values = { ...defaultFieldValues(fields), ...previous };
  for (const field of fields) {
    if (field.secret) values[field.key] = '';
  }
  return values;
}

function PluginsPage({ data, onRefresh, onError }: { data: PluginRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { language, tr, localized } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const selectedType = (Form.useWatch('type', { form, preserve: true }) as string | undefined) ?? editing?.type ?? CHATBOT_PLUGIN_TYPE;
  const definition = pluginDefinition(selectedType);
  const configFields = definition?.configFields ?? [];
  const typeOptions = pluginDefinitions().map((item) => ({ value: item.type, label: `${localized(item.name)} · ${item.type}` }));
  if (selectedType && !definition) typeOptions.push({ value: selectedType, label: selectedType });
  const configSections = configFields.reduce<Array<{ label: string; fields: PluginFieldDefinition[] }>>((sections, field) => {
    const label = field.group ? localized(field.group) : tr('其他');
    const section = sections.at(-1);
    if (section?.label === label) section.fields.push(field);
    else sections.push({ label, fields: [field] });
    return sections;
  }, []);

  const initialConfig = useMemo(() => editableFieldValues(pluginDefinition(editing?.type ?? CHATBOT_PLUGIN_TYPE)?.configFields ?? [], editing?.config), [editing]);

  useEffect(() => {
    if (!drawer.open) return;
    const timer = window.setTimeout(() => {
      form.setFieldsValue({
        name: editing?.name ?? '',
        type: editing?.type ?? CHATBOT_PLUGIN_TYPE,
        description: editing?.description ?? '',
        enabled: editing?.enabled ?? true,
        config: initialConfig,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [drawer.open, editing, form, initialConfig]);

  const save = async (values: { name: string; type: string; description?: string; enabled: boolean; config?: JsonObject }) => {
    setSaving(true);
    try {
      const currentDefinition = pluginDefinition(values.type);
      const config = {
        ...(editing?.config ?? {}),
        ...(currentDefinition ? normalizeFieldValues(currentDefinition.configFields, values.config) : values.config ?? {}),
      };
      await api.savePlugin({ name: values.name, type: values.type, description: values.description ?? '', enabled: values.enabled, config }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<PluginRecord> = [
    { title: tr('插件'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><CodeOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('类型'), dataIndex: 'type', key: 'type', render: (value: string) => <code className="type-code">{value}</code> },
    { title: tr('实例'), key: 'accounts', render: (_, row) => <span className="table-mono">{(row as PluginRecord & { accountCount?: number }).accountCount ?? '—'}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.savePlugin({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除插件')}“${row.name}”？`} description={tr('关联实例可能无法继续运行。')} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePlugin(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <section className="data-page"><PageToolbar count={data.length} noun="PLUGINS" action={tr('新增插件')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<PluginRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 780 }} className="data-table" /> : <EmptyTable title={tr('还没有插件')} description={tr('创建插件记录，再配置平台账号与群聊。')} onCreate={() => drawer.edit()} action={tr('创建插件')} />}
    <Drawer title={<DrawerTitle label="PLUGIN RECORD" title={editing ? tr('编辑插件') : tr('新增插件')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存插件')}</Button></div>}>
      <Form
        key={editing?.id ?? 'new-plugin'}
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={save}
        initialValues={{
          name: editing?.name ?? '',
          type: editing?.type ?? CHATBOT_PLUGIN_TYPE,
          description: editing?.description ?? '',
          enabled: editing?.enabled ?? true,
          config: initialConfig,
        }}
      >
        <Form.Item name="name" label={tr('插件名称')} rules={[{ required: true, message: tr('请输入插件名称') }]}><Input placeholder={tr('例如：群聊助手')} /></Form.Item>
        <Form.Item name="type" label={tr('插件类型')} rules={[{ required: true, message: tr('请输入插件类型') }]}><Select options={typeOptions} placeholder={CHATBOT_PLUGIN_TYPE} onChange={(type: string) => form.setFieldValue('config', editableFieldValues(pluginDefinition(type)?.configFields ?? [], type === editing?.type ? editing.config : {}))} /></Form.Item>
        <Form.Item name="description" label={tr('插件说明')}><Input.TextArea rows={3} placeholder={tr('描述插件用途')} /></Form.Item>
        {configFields.length ? <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('插件设置')}</span><small>{definition?.type} / {configFields.length} FIELDS</small></div>
          {configSections.map((section) => <div key={section.label} className="schema-section">
            <div className="form-section-heading"><span>{section.label}</span><small>{section.fields.length} FIELDS</small></div>
            {section.fields.map((field) => <PluginField key={field.key} field={field} path={['config', field.key]} editing={Boolean(editing)} />)}
          </div>)}
        </div> : <Alert type="info" showIcon message={tr('该插件类型没有声明可配置项。')} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function AccountsPage({ plugins, data, onRefresh, onError }: { plugins: PluginRecord[]; data: BotAccountRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const selectedPluginId = (Form.useWatch('pluginId', { form, preserve: true }) as string | undefined) ?? editing?.pluginId;
  const selectedPlugin = plugins.find((item) => item.id === selectedPluginId);
  const definition = pluginDefinition(selectedPlugin?.type);
  const credentialFields = definition?.credentialFields ?? [];
  const accountFields = definition?.accountFields ?? [];
  useEffect(() => {
    if (!drawer.open) return;
    const currentDefinition = pluginDefinition(plugins.find((item) => item.id === editing?.pluginId)?.type);
    form.resetFields();
    form.setFieldsValue({
      pluginId: editing?.pluginId,
      protocol: editing?.protocol ?? 'qq',
      name: editing?.name ?? '',
      enabled: editing?.enabled ?? true,
      credentials: editableFieldValues(currentDefinition?.credentialFields ?? [], editing?.credentials),
      config: editableFieldValues(currentDefinition?.accountFields ?? [], editing?.config),
    });
  }, [drawer.open, editing, form, plugins]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const credentials = values.credentials as JsonObject ?? {};
      await api.saveAccount({
        pluginId: values.pluginId as string,
        protocol: String(values.protocol ?? ''),
        name: String(values.name),
        enabled: Boolean(values.enabled),
        credentials,
        config: {
          ...(editing?.config ?? {}),
          ...normalizeFieldValues(pluginDefinition(plugins.find((item) => item.id === values.pluginId)?.type)?.accountFields ?? [], values.config as JsonObject),
        },
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<BotAccountRecord> = [
    { title: tr('机器人账号'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><RobotOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('插件'), dataIndex: 'pluginId', key: 'pluginId', render: (id: string) => plugins.find((item) => item.id === id)?.name ?? id },
    { title: tr('平台协议'), dataIndex: 'protocol', key: 'protocol', render: (value: string) => value || '—' },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('群聊'), key: 'groups', render: (_, row) => <span className="table-mono">{row.config.groupCount as number ?? '—'}</span> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveAccount({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除账号')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteAccount(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <section className="data-page"><PageToolbar count={data.length} noun="BOT ACCOUNTS" action={tr('新增账号')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<BotAccountRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 780 }} className="data-table" /> : <EmptyTable title={tr('还没有机器人账号')} description={tr('选择插件并创建账号实例，可为每个平台分别保存凭据。')} onCreate={() => drawer.edit()} action={tr('新增机器人账号')} />}
    <Drawer title={<DrawerTitle label="BOT INSTANCE" title={editing ? tr('编辑机器人账号') : tr('新增机器人账号')} />} width={600} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存账号')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('实例名称')} rules={[{ required: true, message: tr('请输入实例名称') }]}><Input placeholder={tr('例如：主群机器人')} /></Form.Item>
        <Form.Item name="pluginId" label={tr('关联插件')} rules={[{ required: true, message: tr('请选择插件') }]}><Select placeholder={tr('选择插件')} options={plugins.map((item) => ({ label: item.name, value: item.id }))} onChange={(pluginId: string) => {
          const nextDefinition = pluginDefinition(plugins.find((item) => item.id === pluginId)?.type);
          form.setFieldsValue({ credentials: editableFieldValues(nextDefinition?.credentialFields ?? [], pluginId === editing?.pluginId ? editing.credentials : {}), config: editableFieldValues(nextDefinition?.accountFields ?? [], pluginId === editing?.pluginId ? editing.config : {}) });
        }} /></Form.Item>
        {!plugins.length && <Alert type="warning" showIcon message={tr('当前没有插件记录，请先创建插件。')} />}
        <Form.Item name="protocol" label={tr('平台协议')}><Select options={(definition?.protocols ?? ['qq']).map((protocol) => ({ label: protocol.toUpperCase(), value: protocol }))} /></Form.Item>
        {credentialFields.length ? <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('账号凭据')}</span><small>{definition?.type} / {credentialFields.length} FIELDS</small></div>
          {credentialFields.map((field) => <PluginField key={field.key} field={field} path={['credentials', field.key]} editing={Boolean(editing)} />)}
          {editing && <p className="form-note">{tr('敏感字段留空会保留现有值。')}</p>}
        </div> : <Alert type="info" showIcon message={tr('该插件类型没有声明账号字段。')} />}
        {accountFields.length > 0 && <SchemaFields fields={accountFields} path="config" editing={Boolean(editing)} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function SlangReviewEditor({ candidate, onSave }: { candidate: ChatbotSlangCandidate; onSave: (details: { meaning: string; usage: string; example: string; risk: string; sources: string[] }) => void }) {
  const { tr } = useI18n();
  const [form] = Form.useForm<{ meaning: string; usage: string; example: string; risk: string; sourcesText: string }>();
  useEffect(() => {
    form.setFieldsValue({ meaning: candidate.meaning ?? candidate.definition ?? '', usage: candidate.usage ?? '', example: candidate.example ?? '', risk: candidate.risk ?? '', sourcesText: candidate.sources.join('\n') });
  }, [candidate, form]);
  return <Form form={form} layout="vertical" onFinish={(values) => onSave({ meaning: values.meaning, usage: values.usage, example: values.example, risk: values.risk, sources: values.sourcesText.split(/\s+/).filter(Boolean) })}>
    <div className="form-grid two-cols"><Form.Item name="meaning" label={tr('释义')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="usage" label={tr('使用场景')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="example" label={tr('示例')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="risk" label={tr('歧义与风险')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item></div>
    <Form.Item name="sourcesText" label={tr('公共来源 HTTPS URL')} extra={tr('每行一个公开 HTTPS 链接；私网地址会被拒绝。')}><Input.TextArea rows={2} maxLength={5000} /></Form.Item>
    <Button size="small" htmlType="submit">{tr('保存研究内容')}</Button>
  </Form>;
}

function ChatbotRuntimePage({ groups, accounts, onError, onNavigate, onRefresh, view }: { groups: GroupRecord[]; accounts: BotAccountRecord[]; onError: (error: unknown) => void; onNavigate: (page: AdminPage) => void; onRefresh: () => void; view: 'status' | 'approvals' }) {
  const { tr } = useI18n();
  const { message } = AntApp.useApp();
  const [conversationTargets, setConversationTargets] = useState<ChatbotConversationSummary[]>([]);
  const [selectedConversationKey, setSelectedConversationKey] = useState('');
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationListError, setConversationListError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [status, setStatus] = useState<ChatbotConversationStatus | null>(null);
  const [approvals, setApprovals] = useState<ChatbotConversationStatus['pendingApprovals']>([]);
  const [approvalDraft, setApprovalDraft] = useState<{ id: string; tool: string; arguments: string } | null>(null);
  const [wakes, setWakes] = useState<ChatbotWake[]>([]);
  const [memes, setMemes] = useState<ChatbotMemeSummary[]>([]);
  const [memeError, setMemeError] = useState('');
  const [voices, setVoices] = useState<ChatbotVoiceSummary[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const [slang, setSlang] = useState<ChatbotSlangCandidate[]>([]);
  const [slangTerm, setSlangTerm] = useState('');
  const [slangContext, setSlangContext] = useState('');
  const [slangError, setSlangError] = useState('');
  const [wakeError, setWakeError] = useState('');
  const [silent, setSilent] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [disabledToolsText, setDisabledToolsText] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedConversation = conversationTargets.find((item) => JSON.stringify([item.id, item.externalId]) === selectedConversationKey);
  const selectedGroup = groups.find((item) => item.id === selectedConversation?.id);
  useEffect(() => {
    let active = true;
    setConversationLoading(true);
    setConversationListError('');
    api.listChatbotConversations().then((items) => {
      if (!active) return;
      setConversationTargets(items);
      const keys = items.map((item) => JSON.stringify([item.id, item.externalId]));
      setSelectedConversationKey((current) => keys.length ? keys.includes(current) ? current : keys[0] : '');
    }).catch((reason) => {
      if (!active) return;
      setConversationTargets([]);
      setSelectedConversationKey('');
      setConversationListError(formatError(reason));
    }).finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [groups]);
  const refresh = useCallback(async () => {
    if (!selectedConversation || !selectedGroup) {
      setStatus(null); setApprovals([]); setWakes([]); setMemes([]); setVoices([]);
      setStatusError(selectedConversation ? tr('所选会话策略尚未加载，请刷新会话列表。') : '');
      return;
    }
    try {
      const [current, pending] = await Promise.all([
        api.getChatbotConversation(selectedGroup.accountId, selectedGroup.id, selectedConversation.externalId),
        api.listChatbotApprovals(selectedGroup.accountId, selectedGroup.id, selectedConversation.externalId),
      ]);
      setStatusError('');
      setStatus(current); setApprovals(pending.items); setSilent(current.silent);
      setDisabledToolsText(current.disabledTools.join('\n'));
      setInitialPrompt(current.initialPrompt ?? '');
      try {
        const wakeResult = await api.controlChatbotConversation<{ items: ChatbotWake[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'wakeList', externalId: selectedConversation.externalId });
        setWakes(wakeResult.items); setWakeError('');
      } catch (reason) {
        setWakes([]); setWakeError(formatError(reason));
      }
      try {
        const memeResult = await api.controlChatbotConversation<{ items: ChatbotMemeSummary[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'memeList', externalId: selectedConversation.externalId });
        setMemes(memeResult.items); setMemeError('');
      } catch (reason) { setMemes([]); setMemeError(formatError(reason)); }
      try {
        const slangResult = await api.controlChatbotConversation<{ items: ChatbotSlangCandidate[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'slangList', externalId: selectedConversation.externalId });
        setSlang(slangResult.items); setSlangError('');
      } catch (reason) { setSlang([]); setSlangError(formatError(reason)); }
      try {
        const voiceResult = await api.controlChatbotConversation<{ items: ChatbotVoiceSummary[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'voiceList', externalId: selectedConversation.externalId });
        setVoices(voiceResult.items); setVoiceError('');
      } catch (reason) { setVoices([]); setVoiceError(formatError(reason)); }
    } catch (reason) {
      setStatus(null);
      setApprovals([]);
      setStatusError(reason instanceof ApiError && reason.status === 404 ? tr('会话策略已不存在或会话ID已变更，请刷新会话列表。') : formatError(reason));
    }
  }, [selectedGroup, selectedConversation, tr]);
  useEffect(() => { void refresh(); }, [refresh]);
  const runControl = async (payload: Record<string, unknown>) => {
    if (!selectedGroup || !selectedConversation) return;
    setBusy(true);
    try {
      const result = await api.controlChatbotConversation<unknown>(selectedGroup.accountId, selectedGroup.id, { ...payload, externalId: selectedConversation.externalId });
      if (typeof payload.action === 'string' && payload.action.startsWith('voice')) setVoiceError('');
      if (payload.action === 'approvalDecision' && result && typeof result === 'object' && Array.isArray((result as { messages?: unknown }).messages)) {
        const output = ((result as { messages: unknown[] }).messages).filter((item): item is string => typeof item === 'string');
        if (output.length) message.info(output.join('\n'));
      }
      await refresh();
      return result;
    } catch (reason) {
      if (typeof payload.action === 'string' && payload.action.startsWith('voice')) setVoiceError(formatError(reason));
      onError(reason); return undefined;
    }
    finally { setBusy(false); }
  };
  const saveApprovalDraft = async (): Promise<void> => {
    if (!approvalDraft) return;
    let parsed: unknown;
    try { parsed = JSON.parse(approvalDraft.arguments); } catch { message.error(tr('参数必须是有效 JSON')); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { message.error(tr('参数必须是 JSON 对象')); return; }
    const result = await runControl({ action: 'approvalUpdate', approvalId: approvalDraft.id, arguments: approvalDraft.arguments });
    if (result) { setApprovalDraft(null); message.success(tr('工具参数已更新，批准后按新参数执行')); }
  };
  const uploadVoice = async (file: File): Promise<void> => {
    if (!selectedGroup) return;
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setVoiceError(tr('语音文件为空或超过 5 MiB。'));
      return;
    }
    const contentType = file.type === 'audio/mpeg' || file.type === 'audio/wav'
      ? file.type
      : file.name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : file.type;
    setBusy(true);
    setVoiceError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
      await api.controlChatbotConversation(selectedGroup.accountId, selectedGroup.id, {
        action: 'voiceUpload', externalId: selectedConversation?.externalId, voiceName: file.name, voiceContentType: contentType, voiceData: btoa(binary),
      });
      await refresh();
    } catch (reason) {
      setVoiceError(formatError(reason));
      onError(reason);
    } finally { setBusy(false); }
  };
  const approvalColumns: TableColumnsType<ChatbotConversationStatus['pendingApprovals'][number]> = [
    { title: tr('审批 ID'), dataIndex: 'id', key: 'id', ellipsis: true },
    { title: tr('工具'), dataIndex: 'tool', key: 'tool' },
    { title: tr('请求者'), dataIndex: 'requestedBy', key: 'requestedBy' },
    { title: tr('状态'), dataIndex: 'status', key: 'status', render: (value: string) => <Tag>{tr(value === 'pending' ? '待审批' : value)}</Tag> },
    { title: tr('操作'), key: 'actions', render: (_, row) => row.status === 'pending' ? <Space wrap><Button size="small" icon={<EditOutlined />} loading={busy} onClick={() => setApprovalDraft({ id: row.id, tool: row.tool, arguments: JSON.stringify(row.arguments ?? {}, null, 2) })}>{tr('编辑参数')}</Button><Popconfirm title={tr('批准后会在当前会话继续执行该工具，并产生模型/API调用。继续？')} okText={tr('批准')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'approvalDecision', approvalId: row.id, decision: 'approve' })}><Button size="small" type="primary" loading={busy}>{tr('批准')}</Button></Popconfirm><Popconfirm title={tr('拒绝此工具请求？')} okText={tr('拒绝')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'approvalDecision', approvalId: row.id, decision: 'reject' })}><Button size="small" danger loading={busy}>{tr('拒绝')}</Button></Popconfirm></Space> : <span className="muted">—</span> },
  ];
  const wakeColumns: TableColumnsType<ChatbotWake> = [
    { title: tr('计划唤醒'), dataIndex: 'reason', key: 'reason' },
    { title: tr('执行时间'), dataIndex: 'dueAt', key: 'dueAt', render: (value: number) => prettyDate(value) },
    { title: tr('操作'), key: 'actions', render: (_, row) => <Popconfirm title={tr('确定取消此计划唤醒？')} okText={tr('取消唤醒')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'wakeCancel', wakeId: row.id })}><Button size="small" danger>{tr('取消唤醒')}</Button></Popconfirm> },
  ];
  const slangColumns: TableColumnsType<ChatbotSlangCandidate> = [
    { title: tr('群聊用语'), dataIndex: 'term', key: 'term' },
    { title: tr('状态'), dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'confirmed' ? 'success' : value === 'rejected' ? 'error' : 'processing'}>{tr(value === 'confirmed' ? '已确认' : value === 'rejected' ? '已拒绝' : '待审核')}</Tag> },
    { title: tr('命中/人数'), key: 'evidence', render: (_, row) => `${row.hits} / ${row.distinctUsers}` },
    { title: tr('释义'), dataIndex: 'meaning', key: 'meaning', render: (value: string | undefined, row) => value || row.definition || tr('尚未研究') },
    { title: tr('操作'), key: 'actions', render: (_, row) => row.status === 'pending' ? <Space><Button size="small" type="primary" loading={busy} onClick={() => void runControl({ action: 'slangApprove', slangId: row.id })}>{tr('确认用语')}</Button><Button size="small" danger loading={busy} onClick={() => void runControl({ action: 'slangReject', slangId: row.id })}>{tr('拒绝')}</Button><Button size="small" loading={busy} onClick={() => void runControl({ action: 'slangDelete', slangId: row.id })}>{tr('删除')}</Button></Space> : row.status === 'rejected' ? <Button size="small" danger onClick={() => void runControl({ action: 'slangDelete', slangId: row.id })}>{tr('删除')}</Button> : <span className="muted">—</span> },
  ];
  const memeColumns: TableColumnsType<ChatbotMemeSummary> = [
    { title: tr('素材名称'), dataIndex: 'name', key: 'name' },
    { title: tr('图片类型'), dataIndex: 'contentType', key: 'contentType' },
    { title: tr('大小'), dataIndex: 'size', key: 'size', render: (size: number) => `${(size / 1024).toFixed(1)} KB` },
    { title: tr('创建者'), dataIndex: 'createdBy', key: 'createdBy' },
    { title: tr('操作'), key: 'actions', render: (_, item) => <Popconfirm title={tr('删除这个表情素材？')} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'memeDelete', memeName: item.name })}><Button size="small" danger loading={busy}>{tr('删除')}</Button></Popconfirm> },
  ];
  const voiceColumns: TableColumnsType<ChatbotVoiceSummary> = [
    { title: tr('素材名称'), dataIndex: 'name', key: 'name' },
    { title: tr('语音类型'), dataIndex: 'contentType', key: 'contentType' },
    { title: tr('大小'), dataIndex: 'size', key: 'size', render: (size: number) => `${(size / 1024).toFixed(1)} KB` },
    { title: tr('创建者'), dataIndex: 'createdBy', key: 'createdBy' },
    { title: tr('操作'), key: 'actions', render: (_, item) => <Popconfirm title={tr('删除这个语音素材？')} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'voiceDelete', voiceName: item.name })}><Button size="small" danger loading={busy}>{tr('删除')}</Button></Popconfirm> },
  ];
  return <section className="data-page chatbot-runtime-page">
    <Card className="runtime-control-card" title={tr('选择会话')} extra={<Space>
      {selectedGroup && <Button size="small" icon={<SettingOutlined />} onClick={() => onNavigate('groups')}>{tr('打开群聊策略')}</Button>}
      <Button icon={<ReloadOutlined />} onClick={onRefresh}>{tr('刷新会话列表')}</Button>
      {selectedConversation && <Button size="small" onClick={() => void refresh()}>{tr('刷新状态')}</Button>}
      {status && status.gatewayMode === 'websocket' && <Button size="small" loading={busy} onClick={() => void runControl({ action: 'reconnect' })}>{tr('重连 Gateway')}</Button>}
    </Space>}>
      <Select className="full-width" loading={conversationLoading} value={selectedConversationKey || undefined} onChange={setSelectedConversationKey} placeholder={tr('选择账号和会话')} notFoundContent={conversationLoading ? tr('正在加载会话…') : tr('没有可管理会话')} options={conversationTargets.map((item) => ({ value: JSON.stringify([item.id, item.externalId]), label: `${item.accountName} · ${item.name || item.externalId} · ${item.conversationType === 'private' ? tr('私聊') : tr('群聊')}${item.enabled ? '' : ` · ${tr('已停用')}`} · ${item.externalId}` }))} />
      {conversationListError && <Alert className="runtime-empty-alert" type="error" showIcon message={tr('会话列表读取失败')} description={conversationListError} action={<Button size="small" onClick={() => onRefresh()}>{tr('重试')}</Button>} />}
      {!conversationLoading && !conversationListError && conversationTargets.length === 0 && <Alert className="runtime-empty-alert" type="info" showIcon message={tr('尚无可管理会话')} description={tr(groups.length ? '已有会话策略但缺少有效 ID，请到群聊策略补充群聊或私聊 OpenID 后刷新。' : accounts.length ? '会话列表只读取已保存的策略，不会扫描历史聊天。请添加群聊/私聊策略并填写 OpenID。' : '请先配置平台账号，再到群聊策略添加群聊/私聊并填写 OpenID。历史聊天不会自动加入此列表。')} action={<Space>
        <Button type="primary" size="small" onClick={() => onNavigate(accounts.length ? 'groups' : 'accounts')}>{tr(accounts.length ? '添加会话策略' : '配置平台账号')}</Button>
        <Button size="small" onClick={() => onRefresh()}>{tr('刷新')}</Button>
      </Space>} />}
      {statusError && <Alert className="runtime-empty-alert" type="warning" showIcon message={tr('会话状态读取失败')} description={statusError} action={<Button size="small" onClick={onRefresh}>{tr('刷新')}</Button>} />}
      {status && <div className="runtime-status-grid">
        <div><span>{tr('会话策略')}</span><strong>{status.enabled ? tr('启用') : tr('已停用')}</strong></div><div><span>{tr('运行模式')}</span><strong>{status.mode}</strong></div><div><span>{tr('模型')}</span><strong>{status.model || '—'}</strong></div>
        <div><span>{tr('对话上下文')}</span><strong>{status.contextMessages}</strong></div><div><span>{tr('静默')}</span><strong>{status.silent ? tr('启用') : tr('停用')}</strong></div>
        <div><span>{tr('QQ 连接')}</span><strong>{status.connected ? tr('已连接') : tr('未连接')}</strong></div>
        <div><span>{tr('待审批工具')}</span><strong>{approvals.filter((item) => item.status === 'pending').length}</strong></div><div><span>{tr('待继续等待')}</span><strong>{status.pendingAgentWait ? tr('是') : tr('否')}</strong></div>
      </div>}
    </Card>
    {selectedGroup && status && <>
      {view === 'status' && <Card className="runtime-control-card" title={tr('临时会话控制')}>
        <p className="form-note">{tr('此处只操作临时会话状态；常态运行模式、群专属规则和工具审批请到群聊管理配置。')} <Button type="link" onClick={() => onNavigate('groups')}>{tr('打开群聊策略')}</Button></p>
        <div className="runtime-control-row"><span>{tr('静默模式')}</span><Switch checked={silent} onChange={(value) => { setSilent(value); void runControl({ action: 'silent', silent: value }); }} checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></div>
        <label className="runtime-prompt-field"><span>{tr('一次性提示')} · {tr('只会在下一次模型请求中消费；留空后点击保存会清除。')}</span><Input.TextArea value={initialPrompt} maxLength={4000} showCount rows={3} onChange={(event) => setInitialPrompt(event.target.value)} /></label>
        <Space><Button loading={busy} onClick={() => void runControl({ action: 'initialPrompt', prompt: initialPrompt })}>{tr('保存一次性提示')}</Button><Button loading={busy} onClick={() => { setInitialPrompt(''); void runControl({ action: 'initialPrompt', prompt: null }); }}>{tr('清除提示')}</Button></Space>
        <label className="runtime-prompt-field"><span>{tr('额外禁用工具')} · {tr('每行填写一个工具名；只会减少会话策略允许的工具，不能在此提升权限。')}</span><Input.TextArea value={disabledToolsText} rows={3} onChange={(event) => setDisabledToolsText(event.target.value)} /></label>
        <Space><Button loading={busy} onClick={() => void runControl({ action: 'tools', disabledTools: disabledToolsText.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean) })}>{tr('保存工具设置')}</Button><Popconfirm title={tr('清空当前会话上下文？')} okText={tr('清空')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'reset' })}><Button danger loading={busy}>{tr('重置会话上下文')}</Button></Popconfirm></Space>
      </Card>}
      {view === 'approvals' && <Card className="runtime-control-card" title={tr('待审批操作')} extra={<Text type="secondary">{tr('危险 MCP 操作仍需在目标 QQ 会话中由 owner 批准。')}</Text>}>
        <Table<ChatbotConversationStatus['pendingApprovals'][number]> rowKey="id" columns={approvalColumns} dataSource={approvals} pagination={false} locale={{ emptyText: tr('当前没有待审批操作') }} expandable={{ expandedRowRender: (row) => <div className="log-details"><h3>{tr('待执行工具参数')}</h3><DetailValue value={row.arguments ?? { unavailable: 'invalid_json' }} /></div> }} />
      </Card>}
      {view === 'status' && <>
      <Card className="runtime-control-card" title={tr('计划唤醒')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        {wakeError ? <Alert type="info" showIcon message={wakeError} description={tr('计划唤醒查询仅在提供持久唤醒存储的平台可用。')} /> : <Table<ChatbotWake> rowKey="id" columns={wakeColumns} dataSource={wakes} pagination={false} locale={{ emptyText: tr('当前会话没有计划唤醒') }} />}
      </Card>
      <Card className="runtime-control-card" title={tr('已审核表情素材')}>
        {memeError ? <Alert type="info" showIcon message={memeError} description={tr('当前平台未配置持久素材存储。')} /> : <Table<ChatbotMemeSummary> rowKey="name" columns={memeColumns} dataSource={memes} pagination={false} locale={{ emptyText: tr('当前会话还没有已审核表情。') }} />}
      </Card>
      <Card className="runtime-control-card" title={tr('账号语音素材库')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        <p className="form-note">{tr('语音文件按账号共享，仅接受有效 MP3/WAV，单个文件最大 5 MiB。发送语音仍需在 QQ 会话中显式触发。')}</p>
        <label className="runtime-prompt-field"><span>{tr('上传 MP3 或 WAV')}</span><input aria-label={tr('上传 MP3 或 WAV')} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void uploadVoice(file).finally(() => { input.value = ''; }); }} /></label>
        {voiceError ? <Alert type="warning" showIcon message={voiceError} description={tr('账号语音素材存储或请求失败；请检查 KV 配置、文件格式和大小。')} /> : <Table<ChatbotVoiceSummary> rowKey="name" columns={voiceColumns} dataSource={voices} pagination={false} locale={{ emptyText: tr('此账号还没有语音素材。') }} />}
      </Card>
      {(selectedConversation?.conversationType ?? selectedGroup.conversationType ?? 'group') === 'group' && <Card className="runtime-control-card" title={tr('群聊用语研究与审核')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        <p className="form-note">{tr('仅达到群消息阈值的候选会进入研究流程；来源和群聊内容均为非可信数据。必须手动确认后才会进入模型提示词。')}</p>
        {slangError && <Alert type="warning" showIcon message={slangError} description={tr('以下为当前会话内的候选/已确认记录；搜索依赖Brave密钥，失败时候选保持待审核。')} />}
        <div className="form-grid two-cols"><Form.Item label={tr('用语')}><Input maxLength={80} value={slangTerm} onChange={(event) => setSlangTerm(event.target.value)} /></Form.Item><Form.Item label={tr('上下文证据')}><Input.TextArea rows={2} maxLength={1000} value={slangContext} onChange={(event) => setSlangContext(event.target.value)} /></Form.Item></div>
        <Button loading={busy} onClick={() => void runControl({ action: 'slangCreate', slangTerm, slangContext }).then((result) => { if (result) { setSlangTerm(''); setSlangContext(''); } })}>{tr('提交候选')}</Button>
        <Table<ChatbotSlangCandidate> rowKey="id" columns={slangColumns} dataSource={slang} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 850 }} locale={{ emptyText: tr('当前没有群聊用语候选。') }} expandable={{ expandedRowRender: (row) => <SlangReviewEditor candidate={row} onSave={(slangDetails) => void runControl({ action: 'slangUpdate', slangId: row.id, slangDetails })} /> }} />
      </Card>}
      </>}
      <Modal open={Boolean(approvalDraft)} title={`${tr('编辑工具参数')} · ${approvalDraft?.tool ?? ''}`} width={720}
        okText={tr('保存参数')} cancelText={tr('取消')} confirmLoading={busy}
        onOk={() => void saveApprovalDraft()} onCancel={() => setApprovalDraft(null)}>
        <Alert type="warning" showIcon message={tr('仅修改待审批调用的参数，不会直接执行工具')}
          description={tr('保存后仍需点击“批准”才会执行。参数必须为 JSON 对象，且不能包含密钥。')} />
        <Input.TextArea className="approval-json-editor" aria-label={tr('工具参数 JSON')} rows={14} spellCheck={false}
          value={approvalDraft?.arguments ?? ''} onChange={(event) => setApprovalDraft((current) => current ? { ...current, arguments: event.target.value } : current)} />
      </Modal>
    </>}
  </section>;
}

function PolicySelectCard({ type, name, required = false, policies, value, options, detail, href }: {
  type: PolicyType; name: string; required?: boolean; policies: PolicyRecord[]; value?: string;
  options: Array<{ label: string; value: string; disabled: boolean }>; detail: string; href: string;
}) {
  const { tr } = useI18n();
  const policy = policies.find((item) => item.id === value && item.type === type);
  return <div className={`policy-select-card${required ? ' is-required' : ''}${value && !policy?.enabled ? ' is-invalid' : ''}`}>
    <div className="policy-select-head"><strong>{tr(policyTypeNames[type])}</strong><Tag color={required ? 'processing' : 'default'}>{required ? tr('必选') : tr('可选')}</Tag></div>
    <Form.Item name={name} label={tr('所选策略')} rules={[{ validator: async (_, selected: string | undefined) => {
      if (required && !selected) throw new Error(tr('请选择可用策略'));
      if (selected && !policies.some((item) => item.id === selected && item.type === type && item.enabled)) throw new Error(tr('原策略不可用，请重新选择'));
    } }]}>
      <Select allowClear={!required} placeholder={required ? tr('请选择可用策略') : tr('关闭 / 不选择')} options={options} />
    </Form.Item>
    <p className="policy-select-detail">{detail}</p>
    {value && policy && !policy.enabled && <p className="policy-select-warning">{tr('原策略已停用，请重新选择可用策略。')}</p>}
    {value && !policy && <p className="policy-select-warning">{tr('原策略已不存在，请重新选择。')}</p>}
    <a href={href} target="_blank" rel="noopener noreferrer">{tr('在新标签编辑策略')} <ArrowRightOutlined /></a>
  </div>;
}

function GroupsPage({ groups, plugins, accounts, providers, policies, tools, onRefresh, onError }: {
  groups: GroupRecord[]; plugins: PluginRecord[]; accounts: BotAccountRecord[]; providers: ProviderRecord[]; policies: PolicyRecord[]; tools: LibraryRecord[]; onRefresh: () => void; onError: (error: unknown) => void;
}) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = groups.find((item) => item.id === drawer.editingId);
  const selectedAccountId = (Form.useWatch('accountId', { form, preserve: true }) as string | undefined) ?? editing?.accountId;
  const conversationType = (Form.useWatch('conversationType', { form, preserve: true }) as GroupRecord['conversationType']) ?? editing?.conversationType ?? 'group';
  const selectedAccount = accounts.find((item) => item.id === selectedAccountId);
  const selectedPlugin = plugins.find((item) => item.id === selectedAccount?.pluginId);
  const definition = pluginDefinition(selectedPlugin?.type);
  // 私聊白名单只对私聊有意义；群聊的可达范围就是上面的群 ID 列表。
  const visibleConversationFields = conversationFields(definition?.type).filter((field) => field.key !== 'bridge_allowed_private' || conversationType === 'private');
  const basicConfigFields = visibleConversationFields.filter((field) => field.placement === 'basic');
  const advancedConfigFields = visibleConversationFields.filter((field) => field.placement === 'advanced');
  const otherConfigFields = visibleConversationFields.filter((field) => !field.placement);
  const identityPolicyId = Form.useWatch('identityPolicyId', { form, preserve: true }) as string | undefined;
  const identityPolicy = policies.find((item) => item.type === 'identity' && item.id === identityPolicyId && item.enabled);
  const overrideProviderId = Form.useWatch('providerId', { form, preserve: true }) as string | undefined;
  const overrideModel = Form.useWatch('model', { form, preserve: true }) as string | undefined;
  const provider = providers.find((item) => item.id === (overrideProviderId || identityPolicy?.providerId));
  const dialogPolicyId = Form.useWatch('dialogPolicyId', { form, preserve: true }) as string | undefined;
  const voicePolicyId = Form.useWatch('voicePolicyId', { form, preserve: true }) as string | undefined;
  const memoryPolicyId = Form.useWatch('memoryPolicyId', { form, preserve: true }) as string | undefined;
  const costPolicyId = Form.useWatch('costPolicyId', { form, preserve: true }) as string | undefined;
  const approvalMode = Form.useWatch('toolApprovalMode', { form, preserve: true }) as GroupRecord['toolApprovalMode'];
  const whitelistEnabled = Boolean(Form.useWatch('whitelistEnabled', { form, preserve: true }));
  const watchedConfig = Form.useWatch('config', { form, preserve: true }) as JsonObject | undefined;
  const identityPolicies = policies.filter((item) => item.type === 'identity' && item.enabled);
  const availableTools = identityPolicy?.toolIds ?? [];
  const advancedSummary = [
    watchedConfig?.timezone ? String(watchedConfig.timezone) : '',
    watchedConfig?.bridge_reserved_prompt || watchedConfig?.bridge_reserved2_prompt ? tr('预留模式提示') : '',
  ].filter(Boolean).join(' · ') || tr('未启用额外设置');
  useEffect(() => {
    if (!drawer.open) return;
    const currentPlugin = plugins.find((item) => item.id === accounts.find((account) => account.id === editing?.accountId)?.pluginId);
    form.resetFields();
    form.setFieldsValue({
      accountId: editing?.accountId,
      externalIds: editing ? conversationIdList(editing.externalId) : [''],
      conversationType: editing?.conversationType ?? 'group',
      name: editing?.name ?? '', enabled: editing?.enabled ?? true,
      dialogPolicyId: editing?.dialogPolicyId || undefined,
      voicePolicyId: editing?.voicePolicyId || undefined,
      identityPolicyId: editing?.identityPolicyId || undefined,
      memoryPolicyId: editing?.memoryPolicyId || undefined, costPolicyId: editing?.costPolicyId || undefined,
      toolApprovalMode: editing?.toolApprovalMode ?? 'per-tool', toolApprovalRules: editing?.toolApprovalRules ?? {},
      providerId: editing?.providerId || undefined, model: editing?.model || undefined,
      systemPrompt: editing?.systemPrompt ?? '',
      nonMentionReplyRate: editing?.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE,
      whitelistEnabled: editing?.whitelistEnabled ?? false,
      whitelistText: editing?.whitelistUserIds.join('\n') ?? '',
      config: editableFieldValues(conversationFields(pluginDefinition(currentPlugin?.type)?.type), editing?.config),
    });
  }, [drawer.open, editing, form, plugins, accounts]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const userIds = typeof values.whitelistText === 'string' ? values.whitelistText.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean) : values.whitelistUserIds as string[] ?? [];
      const externalIds = conversationIdList(values.externalIds);
      if (values.toolApprovalMode === 'all-allow' && !window.confirm(tr('全部允许将免除本群已授权工具的审批。确认承担调用风险并保存？'))) return;
      if (Boolean(values.providerId) !== Boolean(values.model)) throw new Error(tr('供应商与模型覆盖必须同时填写或同时留空'));
      await api.saveGroup({
        accountId: String(values.accountId), externalId: externalIds.join(','), name: String(values.name ?? ''),
        conversationType: values.conversationType as GroupRecord['conversationType'],
        config: normalizeFieldValues(visibleConversationFields, values.config as JsonObject),
        dialogPolicyId: String(values.dialogPolicyId ?? ''), voicePolicyId: String(values.voicePolicyId ?? ''), identityPolicyId: String(values.identityPolicyId ?? ''),
        memoryPolicyId: String(values.memoryPolicyId ?? ''), costPolicyId: String(values.costPolicyId ?? ''),
        toolApprovalMode: (values.toolApprovalMode as GroupRecord['toolApprovalMode']) ?? 'per-tool',
        toolApprovalRules: Object.fromEntries(Object.entries((values.toolApprovalRules ?? {}) as Record<string, string>).filter(([id, rule]) => availableTools.includes(id) && ['disabled', 'approve', 'allow'].includes(rule))) as GroupRecord['toolApprovalRules'],
        enabled: Boolean(values.enabled), providerId: String(values.providerId ?? ''), model: String(values.model ?? ''),
        systemPrompt: String(values.systemPrompt ?? ''),
        nonMentionReplyRate: Number(values.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE),
        whitelistEnabled: Boolean(values.whitelistEnabled), whitelistUserIds: userIds,
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<GroupRecord> = [
    { title: tr('群聊'), dataIndex: 'name', key: 'name', render: (name: string, row) => {
      const ids = conversationIdList(row.externalId);
      return <div className="table-identity"><span className="identity-icon"><TeamOutlined /></span><span><strong>{name || ids[0] || row.id}</strong>{Boolean(row.migrationRequired?.length) && <Tag color="warning">{tr('旧费用配置待迁移')}</Tag>}<small>{ids[0] ?? ''}{ids.length > 1 ? ` +${ids.length - 1}` : ''} / {row.id}</small></span></div>;
    } },
    { title: tr('会话类型'), dataIndex: 'conversationType', key: 'conversationType', render: (value: string) => <Tag>{value === 'private' ? tr('私聊') : tr('群聊')}</Tag> },
    { title: tr('账号'), dataIndex: 'accountId', key: 'accountId', render: (id: string) => accounts.find((item) => item.id === id)?.name ?? id },
    { title: tr('模型'), dataIndex: 'model', key: 'model', render: (model: string, row) => {
      const identity = policies.find((item) => item.type === 'identity' && item.id === row.identityPolicyId);
      const resolved = row.effective?.model ?? (model || identity?.model || '');
      const effectiveProviderId = row.effective?.providerId ?? (row.providerId || identity?.providerId);
      return <span className="model-cell">{resolved || tr('未配置')}<small>{providers.find((item) => item.id === effectiveProviderId)?.name ?? ''}</small></span>;
    } },
    { title: tr('策略'), key: 'policies', render: (_, row) => {
      const names = [
        policyName(policies, 'identity', row.identityPolicyId),
        policyName(policies, 'dialog', row.dialogPolicyId),
        policyName(policies, 'voice', row.voicePolicyId),
        policyName(policies, 'cost', row.costPolicyId),
        policyName(policies, 'memory', row.memoryPolicyId),
      ].filter(Boolean);
      return names.length ? <div className="model-tags">{names.map((name) => <Tag key={name}>{name}</Tag>)}</div> : <span className="muted">{tr('未选择')}</span>;
    } },
    { title: tr('非 @ 回复率'), dataIndex: 'nonMentionReplyRate', key: 'nonMentionReplyRate', render: (value: number) => <span className="table-mono">{((value ?? DEFAULT_NON_MENTION_REPLY_RATE) * 100).toFixed(0)}%</span> },
    { title: tr('白名单'), dataIndex: 'whitelistEnabled', key: 'whitelistEnabled', render: (enabled: boolean, row) => <span>{enabled ? `${tr('启用')} / ${row.whitelistUserIds.length}` : tr('未启用')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name || row.externalId}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveGroup({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name || row.externalId}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteGroup(row.id).then(onRefresh).catch(onError)}><Button aria-label={tr('删除')} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  const policyOptions = (type: PolicyType) => policies.filter((item) => item.type === type).map((item) => ({ label: `${item.name}${item.enabled ? '' : ` · ${tr('已停用')}`}`, value: item.id, disabled: !item.enabled }));
  return <section className="data-page"><PageToolbar count={groups.length} noun="CONVERSATIONS" action={tr('新增群聊')} onCreate={() => drawer.edit()} />
    {groups.length ? <Table<GroupRecord> rowKey="id" columns={columns} dataSource={groups} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1050 }} className="data-table" /> : <EmptyTable title={tr('还没有绑定的群聊或私聊')} description={tr('先配置可用的身份与对话策略，再绑定平台账号和会话 OpenID。')} onCreate={() => drawer.edit()} action={tr('新增群聊')} />}
    <Drawer title={<DrawerTitle label="CONVERSATION BINDING" title={editing ? tr('编辑群聊') : tr('新增群聊')} />} width={960} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存策略')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        {Boolean(editing?.migrationRequired?.length) && <Alert type="warning" showIcon message={tr('旧费用配置待迁移')} description={tr('旧群的单价或预算不能静默归零。旧单价需先迁到模型价格；旧限额需明确选择费用策略，再保存此群。')} />}
        <p className="form-note form-intro-note">{tr('先绑定账号与会话，再选身份和对话策略。语音、费用、记忆可选；群里仅保存群独有设置。')}</p>
        <div className="form-section-heading"><span>01 / {tr('基本信息')}</span><small>{tr('必填')}</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="accountId" label={tr('机器人账号')} rules={[{ required: true, message: tr('请选择机器人账号') }]}><Select disabled={Boolean(editing)} placeholder={tr('选择账号')} options={accounts.map((item) => ({ label: `${item.name} · ${plugins.find((plugin) => plugin.id === item.pluginId)?.name ?? item.pluginId}`, value: item.id }))} onChange={(accountId: string) => {
            const nextPlugin = plugins.find((item) => item.id === accounts.find((account) => account.id === accountId)?.pluginId);
            form.setFieldValue('config', editableFieldValues(conversationFields(nextPlugin?.type), accountId === editing?.accountId ? editing.config : {}));
          }} /></Form.Item>
          <Form.Item name="conversationType" label={tr('会话类型')} extra={tr('群聊绑定群 openid；私聊绑定用户 openid。')}><Select disabled={Boolean(editing)} options={[{ value: 'group', label: tr('群聊') }, { value: 'private', label: tr('私聊') }]} /></Form.Item>
        </div>
        <Form.Item label={conversationType === 'private' ? tr('允许的用户 openid') : tr('允许的群 ID')} required extra={tr('一条策略可服务多个会话；每个会话的历史、记忆与语音状态仍分别保存。')}>
          <Form.List name="externalIds" rules={[{ validator: async (_, value: string[] | undefined) => {
            if (!Array.isArray(value) || !value.some((item) => String(item ?? '').trim())) throw new Error(tr('请至少填写一个 openid'));
          } }]}>
            {(fields, { add, remove }, { errors }) => <div className="id-list">
              {fields.map(({ key, name, ...restField }) => <div className="id-list-row" key={key}>
                <Form.Item {...restField} name={name} rules={[{ required: true, whitespace: true, message: tr('请输入 openid') }]}>
                  <Input placeholder={conversationType === 'private' ? 'user-openid' : 'group-openid'} />
                </Form.Item>
                <Button type="text" danger aria-label={tr('移除')} icon={<MinusCircleOutlined />} disabled={fields.length <= 1} onClick={() => remove(name)} />
              </div>)}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add('')}>{conversationType === 'private' ? tr('添加用户 openid') : tr('添加群 ID')}</Button>
              <Form.ErrorList errors={errors} />
            </div>}
          </Form.List>
        </Form.Item>
        {selectedAccountId && basicConfigFields.map((field) => <PluginField key={field.key} field={field} path={['config', field.key]} editing={Boolean(editing)} />)}
        <div className="form-grid two-cols">
          <Form.Item name="name" label={tr('群聊名称')}><Input placeholder={tr('可选的群聊备注名称')} /></Form.Item>
          <Form.Item name="enabled" label={tr('启用此群聊策略')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
        </div>
        {editing && <p className="form-note">{tr('账号与会话类型创建后不可变更；会话 ID 可随时增减。')}</p>}
        <div className="form-section-heading"><span>02 / {tr('核心策略')}</span><small>{tr('身份与对话必选')}</small></div>
        {!identityPolicies.length && <Alert type="warning" showIcon message={tr('还没有可用的身份策略')} description={tr('先到策略管理创建身份策略，不能通过群内模型覆盖代替。')} action={<Button size="small" href="#/admin/identities">{tr('去创建')}</Button>} />}
        {!policies.some((item) => item.type === 'dialog' && item.enabled) && <Alert type="warning" showIcon message={tr('还没有可用的对话策略')} action={<Button size="small" href="#/admin/dialogs">{tr('去创建')}</Button>} />}
        <div className="policy-card-grid primary-policies">
          <PolicySelectCard type="identity" name="identityPolicyId" required policies={policies} value={identityPolicyId} options={policyOptions('identity')} detail={identityPolicy ? `${providers.find((item) => item.id === identityPolicy.providerId)?.name ?? tr('未配置')} · ${identityPolicy.model || tr('未配置')}` : tr('选择后显示模型来源')} href="#/admin/identities" />
          <PolicySelectCard type="dialog" name="dialogPolicyId" required policies={policies} value={dialogPolicyId} options={policyOptions('dialog')} detail={policies.find((item) => item.id === dialogPolicyId)?.config.agent_max_rounds !== undefined ? `${tr('工具调用轮数上限')}：${policies.find((item) => item.id === dialogPolicyId)?.config.agent_max_rounds}` : tr('选择后显示回复方式')} href="#/admin/dialogs" />
          <PolicySelectCard type="voice" name="voicePolicyId" policies={policies} value={voicePolicyId} options={policyOptions('voice')} detail={voicePolicyId ? String(policies.find((item) => item.id === voicePolicyId)?.config.voice_model || tr('未配置语音模型')) : tr('关闭，不会调用语音合成')} href="#/admin/voices" />
        </div>
        <div className="policy-card-grid secondary-policies">
          <PolicySelectCard type="cost" name="costPolicyId" policies={policies} value={costPolicyId} options={policyOptions('cost')} detail={costPolicyId ? tr('预算来自费用策略') : tr('未选：不限额；注意可能产生费用')} href="#/admin/budgets" />
          <PolicySelectCard type="memory" name="memoryPolicyId" policies={policies} value={memoryPolicyId} options={policyOptions('memory')} detail={memoryPolicyId ? policies.find((item) => item.id === memoryPolicyId)?.config.memory_enabled === false ? tr('所选策略已关闭会话记忆') : tr('记忆模式来自所选策略') : tr('未选：关闭会话记忆')} href="#/admin/memory-policies" />
        </div>
        {selectedAccountId && otherConfigFields.length > 0 && <SchemaFields fields={otherConfigFields} path="config" editing={Boolean(editing)} />}
        <div className="form-section-heading"><span>03 / {tr('仅此群的差异')}</span><small>{tr('可选覆盖')}</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="providerId" label={tr('AI供应商覆盖')} extra={tr('供应商与模型必须成组覆盖；两项留空继承身份策略。')}><Select allowClear placeholder={tr('继承身份策略')} options={providers.filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
          <Form.Item name="model" label={tr('模型覆盖')}><AutoComplete options={provider?.models.map((model) => ({ label: model, value: model })) ?? []} placeholder={tr('继承身份策略或输入模型 ID')} filterOption /></Form.Item>
        </div>
        <div className="form-grid two-cols">
          <Form.Item name="systemPrompt" label={tr('群专属追加规则')} extra={tr('只追加在身份基础规则之后；人设仅在身份策略编辑，/role 激活时优先使用角色卡。')}><Input.TextArea rows={3} placeholder={tr('此群独有的行为要求；留空使用身份基础规则')} /></Form.Item>
          <Form.Item name="nonMentionReplyRate" label={tr('未 @ 回复概率')} extra={tr('0 表示仅在被 @ 时回复；1 表示每条消息参与判定。')}><InputNumber className="full-width" min={0} max={1} step={0.01} precision={2} /></Form.Item>
        </div>
        <div className="form-grid two-cols">
          <Form.Item name="whitelistEnabled" label={tr('启用用户白名单')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
          <Form.Item name="whitelistText" label={tr('允许的用户 ID')} extra={tr('空格或逗号分隔；白名单关闭时不生效。')}><Input.TextArea rows={2} placeholder="user-id-1, user-id-2" /></Form.Item>
        </div>
        <div className="form-section-heading"><span>{tr('工具审批')}</span><small>{tr('只能约束身份已授权的工具')}</small></div>
        <Form.Item name="toolApprovalMode" label={tr('审批模式')}><Select options={[{ value: 'per-tool', label: tr('逐工具设置') }, { value: 'all-approve', label: tr('全部需要审批') }, { value: 'all-allow', label: tr('全部允许（高风险）') }]} /></Form.Item>
        {approvalMode === 'all-allow' && <Alert type="warning" showIcon message={tr('全部允许会跳过此群已授权工具的人工审批，保存时必须再次确认。')} />}
        {approvalMode === 'per-tool' && (availableTools.length ? <div className="tool-approval-list">{availableTools.map((id) => <Form.Item key={id} name={['toolApprovalRules', id]} label={tools.find((item) => item.id === id)?.name ?? id}><Select options={[{ value: 'approve', label: tr('需要审批') }, { value: 'allow', label: tr('允许') }, { value: 'disabled', label: tr('禁用') }]} placeholder={tr('按身份策略默认规则')} allowClear /></Form.Item>)}</div> : <p className="form-note">{tr('当前身份策略未授权工具，无法在群内增加工具。')}</p>)}
        <div className="effective-summary" aria-live="polite">
          {editing?.effective && <>
            <strong>{tr('已保存的服务端生效值')}</strong>
            <div>{tr('模型')}：{providers.find((item) => item.id === editing.effective?.providerId)?.name ?? (editing.effective.providerId || tr('未配置'))} / {editing.effective.model || tr('未配置')} · {editing.providerId ? tr('本群覆盖') : tr('身份策略')}</div>
            <div>{tr('人设')}：{editing.effective.persona ? tr('身份策略默认人设（会话 /role 可覆盖）') : tr('未配置')} · {tr('合并后规则')}：{editing.effective.systemPrompt ? editing.systemPrompt ? tr('身份策略 + 本群追加') : tr('身份策略') : tr('未设置')}</div>
            <div>{tr('费用')}：{tr('每日限额')} ${editing.effective.dailyCostLimit} / {tr('每月限额')} ${editing.effective.monthlyCostLimit} / {tr('总限额')} ${editing.effective.totalCostLimit} · {editing.costPolicyId ? tr('费用策略') : tr('不限额')}</div>
          </>}
          <strong>{tr('当前表单选择（保存后才生效）')}</strong>
          <div>{tr('人设和基础规则')}：{identityPolicy?.name ?? tr('未选择身份策略')} · {tr('模型')}：{overrideModel && overrideProviderId ? `${provider?.name ?? overrideProviderId} / ${overrideModel} (${tr('本群覆盖')})` : `${providers.find((item) => item.id === identityPolicy?.providerId)?.name ?? tr('未配置')} / ${identityPolicy?.model || tr('未配置')} (${tr('身份策略')})`}</div>
          <div>{tr('对话')}：{policyName(policies, 'dialog', dialogPolicyId) || tr('未选择')} · {tr('语音')}：{policyName(policies, 'voice', voicePolicyId) || tr('关闭')}</div>
          <div>{tr('费用')}：{policyName(policies, 'cost', costPolicyId) || tr('不限额')} · {tr('记忆')}：{policyName(policies, 'memory', memoryPolicyId) || tr('关闭')}</div>
        </div>
        <div className="form-section-heading"><span>04 / {tr('高级选项')}</span><small>{tr('按需展开')}</small></div>
        <Collapse className="policy-overrides advanced-settings" size="small" items={[{ key: 'advanced', label: tr('时区与预留模式参数'), extra: <span className="policy-overrides-summary">{advancedSummary}</span>, children: <>
          {selectedAccountId && advancedConfigFields.length > 0 && <SchemaFields fields={advancedConfigFields} path="config" editing={Boolean(editing)} />}
        </> }]} />
      </Form>
    </Drawer>
  </section>;
}

function ProjectMemoriesPanel({ data, accounts, onRefresh, onError }: { data: ProjectMemoryRecord[]; accounts: BotAccountRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr, language } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const editing = data.find((item) => item.id === drawer.editingId);
  const visible = data.filter((item) => !query || `${item.name} ${item.title} ${item.desc} ${item.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ accountId: editing?.accountId ?? accounts[0]?.id, type: editing?.type ?? 'project', name: editing?.name ?? '', title: editing?.title ?? '', desc: editing?.desc ?? '', content: editing?.content ?? '', time: editing?.time ?? new Date().toISOString() });
  }, [drawer.open, editing, accounts, form]);
  const save = async (values: { accountId: string; type: MemoryType; name: string; title: string; desc?: string; content: string; time: string }) => {
    setSaving(true);
    try {
      await api.saveProjectMemory({ accountId: values.accountId, type: values.type, name: values.name, title: values.title, desc: values.desc ?? '', content: values.content, time: values.time }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<ProjectMemoryRecord> = [
    { title: tr('项目记忆'), dataIndex: 'title', key: 'title', render: (title: string, row) => <div className="table-identity"><span className="identity-icon"><DatabaseOutlined /></span><span><strong>{title}</strong><small>{accounts.find((account) => account.id === row.accountId)?.name ?? row.accountId} · {row.name}</small></span></div> },
    { title: tr('类型'), dataIndex: 'type', key: 'type', render: (value: MemoryType) => tr(({ user: '用户偏好', feedback: '反馈', project: '项目', reference: '参考资料' } as Record<MemoryType, string>)[value]) },
    { title: tr('说明'), dataIndex: 'desc', key: 'desc', ellipsis: true },
    { title: tr('更新时间'), dataIndex: 'time', key: 'time', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', render: (_, row) => <Space><Button size="small" icon={<EditOutlined />} aria-label={`${tr('编辑')} ${row.name}`} onClick={() => drawer.edit(row.id)} /><Popconfirm title={`${tr('删除')}“${row.title}”？`} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void api.deleteProjectMemory(row.accountId, row.id).then(onRefresh).catch(onError)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={visible.length} noun="PROJECT MEMORIES" action={tr('新增记忆')} onCreate={() => drawer.edit()} />
    <Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('搜索记忆名称、标题或正文')} aria-label={tr('搜索记忆')} className="memory-search" />
    {visible.length ? <Table<ProjectMemoryRecord> rowKey="id" dataSource={visible} columns={columns} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 850 }} className="data-table" expandable={{ expandedRowRender: (row) => <div className="log-details"><h3>{tr('项目记忆内容')}</h3><DetailValue value={row.content} /></div> }} /> : <EmptyTable title={tr('还没有项目记忆')} description={tr('按账号存储可由所选会话检索的共享记忆。')} onCreate={() => drawer.edit()} action={tr('新增记忆')} />}
    <Drawer title={<DrawerTitle label="PROJECT MEMORY" title={editing ? tr('编辑记忆') : tr('新增记忆')} />} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('返回')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="accountId" label={tr('所属账号')} rules={[{ required: true, message: tr('请选择账号') }]}><Select disabled={Boolean(editing)} options={accounts.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="type" label={tr('类型')} rules={[{ required: true }]}><Select options={[{ value: 'user', label: tr('用户偏好') }, { value: 'feedback', label: tr('反馈') }, { value: 'project', label: tr('项目') }, { value: 'reference', label: tr('参考资料') }]} /></Form.Item>
        <Form.Item name="name" label={tr('记忆名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="title" label={tr('标题')} rules={[{ required: true, message: tr('请输入标题') }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="desc" label={tr('说明')}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        <Form.Item name="content" label={tr('记忆内容')} rules={[{ required: true, message: tr('请输入内容') }]}><Input.TextArea rows={8} showCount maxLength={20000} /></Form.Item>
        <Form.Item name="time" label={tr('记录时间')} rules={[{ required: true }]}><Input /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function policySummary(type: PolicyType, policy: PolicyRecord, providers: ProviderRecord[]): string {
  const config = policy.config ?? {};
  const value = (key: string, fallback: string) => (typeof config[key] === 'string' ? config[key] as string : fallback);
  const count = (key: string, fallback: number) => (typeof config[key] === 'number' ? config[key] as number : fallback);
  if (type === 'dialog') {
    return [config.agent_stream === true ? 'stream' : 'buffered', `${count('agent_max_rounds', 5)} rounds`, `${count('agent_max_output_tokens', 4096)} tok`, `T ${count('agent_temperature', 0.7)}`].join(' · ');
  }
  if (type === 'voice') {
    return [value('voice_model', '—'), value('voice_id', 'alloy'), `${count('voice_speed', 1)}x`, `${count('voice_max_text_chars', 500)} chars`].join(' · ');
  }
  if (type === 'cost') return `USD · daily $${count('dailyCostLimit', 0)} · monthly $${count('monthlyCostLimit', 0)} · total $${count('totalCostLimit', 0)}`;
  if (type === 'memory') return [value('memoryMode', 'manual'), `${count('maxEntries', 100)} items`, `${count('retentionDays', 7)} days`].join(' · ');
  const provider = providers.find((item) => item.id === policy.providerId);
  return [policy.model || '—', provider?.name ?? '', policy.reasoningEffort && policy.reasoningEffort !== 'default' ? policy.reasoningEffort : 'model default',
    `Skills ${policy.skillIds?.length ?? 0} / MCP ${policy.mcpIds?.length ?? 0} / Rules ${policy.ruleIds?.length ?? 0}`].filter(Boolean).join(' · ');
}

function PolicyPanel({ type, data, providers, libraries, tools = [], onRefresh, onError }: {
  type: PolicyType; data: PolicyRecord[]; providers: ProviderRecord[]; libraries: LibraryData; tools?: LibraryRecord[]; onRefresh: () => void; onError: (error: unknown) => void;
}) {
  const { language, tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => policyFields(type), [type]);
  const rows = data.filter((item) => item.type === type);
  const editing = rows.find((item) => item.id === drawer.editingId);
  const isIdentity = type === 'identity';
  const providerId = (Form.useWatch('providerId', { form, preserve: true }) as string | undefined) || editing?.providerId;
  const provider = providers.find((item) => item.id === providerId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
      providerId: editing?.providerId || undefined,
      model: editing?.model || undefined,
      reasoningEffort: editing?.reasoningEffort ?? 'default',
      persona: editing?.persona ?? '',
      systemPrompt: editing?.systemPrompt ?? '',
      skillIds: editing?.skillIds ?? [], mcpIds: editing?.mcpIds ?? [], ruleIds: editing?.ruleIds ?? [], toolIds: editing?.toolIds ?? [],
      config: type === 'cost' ? { dailyCostLimit: 0, monthlyCostLimit: 0, totalCostLimit: 0, ...editing?.config }
        : type === 'memory' ? { memoryMode: 'manual', maxEntries: 100, retentionDays: 7, memory_enabled: true, ...editing?.config }
          : editableFieldValues(fields, editing?.config),
    });
  }, [drawer.open, editing, form, fields, type]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.savePolicy({
        type,
        name: String(values.name ?? ''),
        description: String(values.description ?? ''),
        enabled: Boolean(values.enabled),
        config: type === 'cost' || type === 'memory' ? values.config as JsonObject : { ...(editing?.config ?? {}), ...normalizeFieldValues(fields, values.config as JsonObject) },
        ...(isIdentity ? {
          providerId: String(values.providerId ?? ''),
          model: String(values.model ?? ''),
          persona: String(values.persona ?? ''), systemPrompt: String(values.systemPrompt ?? ''),
          reasoningEffort: values.reasoningEffort as PolicyRecord['reasoningEffort'],
          skillIds: values.skillIds as string[] ?? [], mcpIds: values.mcpIds as string[] ?? [], ruleIds: values.ruleIds as string[] ?? [], toolIds: values.toolIds as string[] ?? [],
        } : {}),
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const choices = (kind: LibraryKind) => libraries[kind].map((item) => ({ label: `${item.name}${item.enabled ? '' : ` · ${tr('已停用')}`}`, value: item.id }));
  const columns: TableColumnsType<PolicyRecord> = [
    { title: tr('名称'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ThunderboltOutlined /></span><span><strong>{name}</strong><small>{row.description || row.id}</small></span></div> },
    { title: tr('概要'), key: 'summary', render: (_, row) => <span className="table-mono">{policySummary(type, row, providers)}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.savePolicy({ type: row.type, name: row.name, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除策略')}“${row.name}”？`} description={tr('仍被群聊引用的策略无法删除。')} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePolicy(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={rows.length} noun="CAPABILITY POLICIES" action={tr('新增策略')} onCreate={() => drawer.edit()} />
    {rows.length ? <Table<PolicyRecord> rowKey="id" columns={columns} dataSource={rows} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 820 }} className="data-table" /> : <EmptyTable title={tr('还没有策略')} description={`${tr('创建可复用的')}${tr(policyTypeNames[type])}${tr('，再在群聊策略中引用。')}`} onCreate={() => drawer.edit()} action={tr('创建策略')} />}
    <Drawer title={<DrawerTitle label="CAPABILITY POLICY" title={`${editing ? tr('编辑策略') : tr('新增策略')} · ${tr(policyTypeNames[type])}`} />} width={620} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存策略')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('策略名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input placeholder={tr('例如：群聊默认身份')} /></Form.Item>
        <Form.Item name="description" label={tr('策略说明')}><Input.TextArea rows={2} placeholder={tr('说明该策略的适用范围')} /></Form.Item>
        {isIdentity && <>
          <div className="form-grid two-cols">
            <Form.Item name="providerId" label={tr('AI供应商')}><Select allowClear placeholder={tr('沿用插件默认')} options={providers.filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
            <Form.Item name="model" label={tr('模型')}><AutoComplete options={provider?.models.map((model) => ({ label: model, value: model })) ?? []} placeholder={tr('选择或输入模型 ID')} filterOption /></Form.Item>
          </div>
          <Form.Item name="reasoningEffort" label={tr('思考强度')} extra={tr('模型默认不发送思考强度参数，适用于不支持该参数的模型。')}><Select options={[{ label: tr('模型默认'), value: 'default' }, { label: tr('低 / low'), value: 'low' }, { label: tr('中 / medium'), value: 'medium' }, { label: tr('高 / high'), value: 'high' }]} /></Form.Item>
          <Form.Item name="persona" label={tr('默认人设')} extra={tr('描述身份、语气和风格；使用 /role 角色卡时由角色卡代替，避免两份人设叠加。')}><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="systemPrompt" label={tr('基础系统规则')} extra={tr('写不随角色变化的约束；群专属规则只追加，不能覆盖此处。')}><Input.TextArea rows={4} /></Form.Item>
          <div className="form-grid three-cols capability-columns">
            <Form.Item name="skillIds" label="Skills"><Select mode="multiple" placeholder={tr('选择可用 Skills')} options={choices('skills')} /></Form.Item>
            <Form.Item name="mcpIds" label="MCP"><Select mode="multiple" placeholder={tr('选择 MCP 服务')} options={choices('mcps')} /></Form.Item>
            <Form.Item name="ruleIds" label="Rules"><Select mode="multiple" placeholder={tr('选择规则集')} options={choices('rules')} /></Form.Item>
          </div>
          <Form.Item name="toolIds" label={tr('授权工具')} extra={tr('仅从已配置的工具目录授权；群聊不能再增加可用工具。')}><Select mode="multiple" placeholder={tr('选择可用工具')} options={tools.map((item) => ({ value: item.id, label: item.config.kind === 'builtin' ? `${item.name} · ${String(item.config.name ?? item.id)}` : item.name, disabled: !item.enabled }))} /></Form.Item>
        </>}
        {type === 'cost' && <><p className="form-note">{tr('预算币种为 USD；0 代表不限额，日/月/总上限均是可复用策略的配置。')}</p><div className="form-grid three-cols">
          <Form.Item name={['config', 'dailyCostLimit']} label={tr('每日限额')} rules={[{ required: true }]}><InputNumber min={0} precision={2} addonBefore="$" className="full-width" /></Form.Item>
          <Form.Item name={['config', 'monthlyCostLimit']} label={tr('每月限额')} rules={[{ required: true }]}><InputNumber min={0} precision={2} addonBefore="$" className="full-width" /></Form.Item>
          <Form.Item name={['config', 'totalCostLimit']} label={tr('总限额')} rules={[{ required: true }]}><InputNumber min={0} precision={2} addonBefore="$" className="full-width" /></Form.Item>
        </div></>}
        {type === 'memory' && <><Form.Item name={['config', 'memoryMode']} label={tr('记忆写入模式')}><Select options={[{ value: 'manual', label: tr('仅 owner 手动 /save') }, { value: 'review', label: tr('自动候选，管理员审核') }, { value: 'auto', label: tr('自动写入') }]} /></Form.Item><div className="form-grid two-cols">
          <Form.Item name={['config', 'maxEntries']} label={tr('最大记忆条数')}><InputNumber min={1} max={1000} className="full-width" /></Form.Item>
          <Form.Item name={['config', 'retentionDays']} label={tr('最近更新后保留天数')}><InputNumber min={1} max={365} className="full-width" /></Form.Item>
        </div><Form.Item name={['config', 'memory_enabled']} label={tr('启用会话记忆')} valuePropName="checked"><Switch /></Form.Item></>}
        {type !== 'cost' && type !== 'memory' && <SchemaFields fields={fields} path="config" editing={Boolean(editing)} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function ProvidersPanel({ data, onRefresh, onError }: { data: ProviderRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const models = Form.useWatch('models', { form, preserve: true }) as string[] | undefined;
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', baseUrl: editing?.baseUrl ?? '', apiKey: '', enabled: editing?.enabled ?? true, models: editing?.models ?? [], priceMultiplier: editing?.priceMultiplier ?? 1, mediaCapabilities: editing?.mediaCapabilities ?? ['image'] });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; baseUrl: string; apiKey?: string; enabled: boolean; models?: string[]; priceMultiplier?: number; mediaCapabilities?: ProviderRecord['mediaCapabilities'] }) => {
    setSaving(true);
    try {
      await api.saveProvider({ name: values.name, baseUrl: values.baseUrl, ...(values.apiKey ? { apiKey: values.apiKey } : {}), enabled: values.enabled, models: values.models ?? [], priceMultiplier: values.priceMultiplier ?? 1, mediaCapabilities: values.mediaCapabilities ?? ['image'] }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const discoverModels = async () => {
    if (!editing) return;
    setDiscovering(true);
    try {
      const foundModels = await api.discoverModels(editing.id);
      form.setFieldValue('models', [...new Set([...(models ?? []), ...foundModels])]);
      if (foundModels.length === 0) onError(new Error(tr('供应商未返回可用模型')));
    } catch (reason) {
      onError(reason);
    } finally {
      setDiscovering(false);
    }
  };
  const columns: TableColumnsType<ProviderRecord> = [
    { title: tr('供应商'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ApiOutlined /></span><span><strong>{name}</strong><small>{row.baseUrl}</small></span></div> },
    { title: tr('模型'), dataIndex: 'models', key: 'models', render: (values: string[]) => <div className="model-tags">{values.length ? values.slice(0, 3).map((value) => <Tag key={value}>{value}</Tag>) : <span className="muted">{tr('尚未登记')}</span>}{values.length > 3 && <span>+{values.length - 3}</span>}</div> },
    { title: tr('API 计价倍率'), dataIndex: 'priceMultiplier', key: 'priceMultiplier', align: 'right', render: (value?: number) => <span className="table-mono">× {value ?? 1}</span> },
    { title: tr('密钥'), dataIndex: 'apiKey', key: 'apiKey', render: (value: string) => value ? <span className="secret-mask">••••••••</span> : <span className="muted">{tr('未配置')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑供应商')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveProvider({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除供应商')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteProvider(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun="OPENAI-COMPATIBLE PROVIDERS" action={tr('新增供应商')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<ProviderRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={tr('还没有AI供应商')} description={tr('添加 OpenAI 兼容 API，并登记可用的模型 ID。')} onCreate={() => drawer.edit()} action={tr('添加供应商')} />}
    <Drawer title={<DrawerTitle label="MODEL PROVIDER" title={editing ? tr('编辑供应商') : tr('新增供应商')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存供应商')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('供应商名称')} rules={[{ required: true, message: tr('请输入供应商名称') }]}><Input placeholder={tr('例如：团队模型网关')} /></Form.Item>
        <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true, message: tr('请输入 Base URL') }, { type: 'url', message: tr('请输入有效 URL') }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>
        <Form.Item name="apiKey" label="API Key" extra={editing ? tr('为安全起见密钥不会回显；留空表示保持现有密钥。') : tr('密钥由服务端保存，请勿分享控制台截图。')}><Input.Password autoComplete="new-password" placeholder={editing ? tr('留空以保持现有密钥') : tr('输入 API Key')} /></Form.Item>
        <Form.Item name="priceMultiplier" label={tr('API 计价倍率')} extra={tr('默认 1。该 API 的模型成本按基础模型单价乘以此倍率估算。')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={4} step={0.1} className="full-width" addonBefore="×" /></Form.Item>
        <Form.Item name="mediaCapabilities" label={tr('API 媒体能力')} extra={tr('仅选择该供应商实际支持的能力。默认图片；清空表示仅使用文本，不会自动验证或承诺 API 支持。')}><Select mode="multiple" virtual={false} allowClear placeholder={tr('选择供应商支持的媒体能力')} options={[{ value: 'image', label: tr('图片') }, { value: 'audio', label: tr('音频') }, { value: 'video', label: tr('视频') }, { value: 'file', label: tr('文件') }, { value: 'speech', label: tr('语音合成') }]} /></Form.Item>
        <Form.Item name="models" label={tr('可用模型')} extra={tr('输入模型 ID 后按 Enter 添加。')}><Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="gpt-4o-mini" /></Form.Item>
        <div className="discover-row"><Button icon={<ReloadOutlined />} loading={discovering} disabled={!editing} onClick={() => void discoverModels()}>{tr('自动获取模型')}</Button><span>{editing ? tr('通过服务端安全请求供应商 /models') : tr('请先保存供应商，再获取模型列表')}</span></div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function PricesPanel({ data, onRefresh, onError }: { data: ModelPriceRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const { message } = AntApp.useApp();
  const drawer = useDrawer();
  const [form] = Form.useForm<ModelPriceRecord>();
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const editing = data.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', model: editing?.model ?? '', inputCostPerMillion: editing?.inputCostPerMillion ?? 0, outputCostPerMillion: editing?.outputCostPerMillion ?? 0, cacheInputCostPerMillion: editing?.cacheInputCostPerMillion, imageTextInputCostPerMillion: editing?.imageTextInputCostPerMillion, imageInputCostPerMillion: editing?.imageInputCostPerMillion, imageCachedInputCostPerMillion: editing?.imageCachedInputCostPerMillion, imageOutputCostPerMillion: editing?.imageOutputCostPerMillion, unit: editing?.unit ?? 'tokens', sourceUrl: editing?.sourceUrl ?? '', enabled: editing?.enabled ?? true });
  }, [drawer.open, editing, form]);
  const save = async (values: Omit<ModelPriceRecord, 'cacheInputCostPerMillion'> & { cacheInputCostPerMillion?: number | null }) => {
    setSaving(true);
    try {
      await api.savePrice({ ...values, currency: 'USD' }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const importPresets = async () => {
    setImporting(true);
    let imported = 0;
    try {
      for (const preset of MODEL_PRICE_PRESETS.filter((item) => presetIds.includes(item.id) && !data.some((saved) => saved.model === item.model))) {
        await api.savePrice({ name: preset.name, model: preset.model, inputCostPerMillion: preset.inputCostPerMillion, outputCostPerMillion: preset.outputCostPerMillion, cacheInputCostPerMillion: preset.cacheInputCostPerMillion, imageTextInputCostPerMillion: preset.imageTextInputCostPerMillion, imageInputCostPerMillion: preset.imageInputCostPerMillion, imageCachedInputCostPerMillion: preset.imageCachedInputCostPerMillion, imageOutputCostPerMillion: preset.imageOutputCostPerMillion, currency: preset.currency, unit: preset.unit ?? 'tokens', sourceUrl: preset.sourceUrl, enabled: true });
        imported += 1;
      }
      message.success(`${tr('已导入预置单价')}：${imported}`);
      setPresetIds([]);
    } catch (reason) {
      onError(new Error(`${tr('已导入预置单价')}：${imported}；${formatError(reason)}`));
    } finally {
      setImporting(false);
      if (imported > 0) onRefresh();
    }
  };
  const importAllPresets = async () => {
    const missing = MODEL_PRICE_PRESETS.filter((item) => !data.some((saved) => saved.model === item.model));
    if (!missing.length) { message.info(tr('所有预置模型都已有单价')); return; }
    setImportingAll(true);
    let imported = 0;
    try {
      for (const preset of missing) {
        await api.savePrice({ name: preset.name, model: preset.model, inputCostPerMillion: preset.inputCostPerMillion, outputCostPerMillion: preset.outputCostPerMillion, cacheInputCostPerMillion: preset.cacheInputCostPerMillion, imageTextInputCostPerMillion: preset.imageTextInputCostPerMillion, imageInputCostPerMillion: preset.imageInputCostPerMillion, imageCachedInputCostPerMillion: preset.imageCachedInputCostPerMillion, imageOutputCostPerMillion: preset.imageOutputCostPerMillion, currency: preset.currency, unit: preset.unit ?? 'tokens', sourceUrl: preset.sourceUrl, enabled: true });
        imported += 1;
      }
      message.success(`${tr('已导入预置单价')}：${imported}`);
    } catch (reason) {
      onError(new Error(`${tr('已导入预置单价')}：${imported}；${formatError(reason)}`));
    } finally {
      setImportingAll(false);
      if (imported > 0) onRefresh();
    }
  };
  const columns: TableColumnsType<ModelPriceRecord> = [
    { title: tr('模型'), dataIndex: 'model', key: 'model', render: (value: string, row) => <div className="model-cell">{value}<small>{row.name}</small></div> },
    { title: tr('计价单位'), dataIndex: 'unit', key: 'unit', render: (value?: string) => value === 'characters' ? tr('百万字符') : tr('百万 token') },
    { title: tr('输入成本'), dataIndex: 'inputCostPerMillion', key: 'input', align: 'right', render: (value: number) => <span className="table-mono">${value}</span> },
    { title: tr('输出成本'), dataIndex: 'outputCostPerMillion', key: 'output', align: 'right', render: (value: number) => <span className="table-mono">${value}</span> },
    { title: tr('缓存输入单价'), dataIndex: 'cacheInputCostPerMillion', key: 'cache', align: 'right', render: (value?: number) => <span className="table-mono">{value === undefined ? '—' : `$${value}`}</span> },
    { title: tr('图像输出单价'), dataIndex: 'imageOutputCostPerMillion', key: 'image-output', align: 'right', render: (value?: number) => <span className="table-mono">{value === undefined ? '—' : `$${value}`}</span> },
    { title: tr('计价来源'), dataIndex: 'sourceUrl', key: 'source', ellipsis: true, render: (value: string | undefined, row) => <span className="price-source" title={value}>{value || tr('手动登记')} · {prettyDate(row.updatedAt)}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (value: boolean) => <StatusTag enabled={value} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Button size="small" aria-label={`${tr('编辑')} ${row.model}`} icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /><Switch checked={row.enabled} aria-label={`${row.model} ${tr('启用状态')}`} onChange={(enabled) => void api.savePrice({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除模型单价')} ${row.model}？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePrice(row.id).then(onRefresh).catch(onError)}><Button danger size="small" aria-label={`${tr('删除')} ${row.model}`} icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun="USD / 1M UNITS" action={tr('新增模型单价')} onCreate={() => drawer.edit()} />
    <p className="form-note">{tr('预置为公开价目快照，可能包含第三方比价，不会自动更新；导入前请核对来源。')} {tr('文本价格核对日期')}：{MODEL_PRICE_CHECKED_AT} · {tr('图像价格核对日期')}：{IMAGE_MODEL_PRICE_CHECKED_AT}</p>
    <p className="form-note">{tr('未登记单价的文本模型按默认 $3 输入 / $15 输出每百万 token 计费，不再拒绝执行。')}</p>
    <div className="preset-import"><Select mode="multiple" virtual={false} optionFilterProp="label" value={presetIds} onChange={setPresetIds} aria-label={tr('选择预置模型单价')} placeholder={tr('选择预置模型单价')} options={MODEL_PRICE_PRESETS.map((item) => ({ label: `${item.name} · $${item.inputCostPerMillion} / $${item.outputCostPerMillion}`, value: item.id, disabled: data.some((saved) => saved.model === item.model) }))} /><Button loading={importing} disabled={!presetIds.length} onClick={() => void importPresets()}>{tr('导入所选预置')}</Button><Popconfirm title={tr('导入全部缺少的预置？')} okText={tr('导入')} cancelText={tr('取消')} onConfirm={() => void importAllPresets()}><Button loading={importingAll}>{tr('导入全部缺少的预置')}</Button></Popconfirm></div>
    {data.length ? <Table<ModelPriceRecord> rowKey="id" dataSource={data} columns={columns} className="data-table" scroll={{ x: 1000 }} pagination={{ pageSize: 8, showSizeChanger: false }} /> : <EmptyTable title={tr('还没有模型单价')} description={tr('手动登记或选择官方预置导入，再在群聊选择模型。')} />}
    <Drawer title={<DrawerTitle label="MODEL PRICING" title={editing ? tr('编辑模型单价') : tr('新增模型单价')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="model" label={tr('模型 ID')} extra={tr('与供应商模型 ID 对齐；精确匹配优先，也支持版本后缀。')} rules={[{ required: true, message: tr('此字段为必填项') }]}><Input /></Form.Item>
        <div className="form-grid two-cols">
          <Form.Item name="inputCostPerMillion" label={tr('输入成本')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
          <Form.Item name="outputCostPerMillion" label={tr('输出成本')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
          <Form.Item name="cacheInputCostPerMillion" label={tr('缓存输入单价')}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
        </div>
        <div className="form-section-heading"><span>{tr('图像生成模态价格')}</span><small>USD / 1M TOKEN</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="imageTextInputCostPerMillion" label={tr('图像文本输入单价')}><InputNumber min={0} precision={6} addonBefore="$" className="full-width" /></Form.Item>
          <Form.Item name="imageInputCostPerMillion" label={tr('图像输入单价')}><InputNumber min={0} precision={6} addonBefore="$" className="full-width" /></Form.Item>
          <Form.Item name="imageCachedInputCostPerMillion" label={tr('图像缓存输入单价')}><InputNumber min={0} precision={6} addonBefore="$" className="full-width" /></Form.Item>
          <Form.Item name="imageOutputCostPerMillion" label={tr('图像输出单价')}><InputNumber min={0} precision={6} addonBefore="$" className="full-width" /></Form.Item>
        </div>
        <Form.Item name="unit" label={tr('计价单位')}><Select options={[{ value: 'tokens', label: tr('百万 token') }, { value: 'characters', label: tr('百万字符') }]} /></Form.Item>
        <p className="form-note">{tr('价格按 USD / 百万所选单位登记。缓存单价可选，未填写时使用标准输入单价。')}</p>
        <Form.Item name="sourceUrl" label={tr('来源地址')} rules={[{ type: 'url', message: tr('请输入有效 URL') }]}><Input /></Form.Item>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function DetailValue({ value, labels = {} }: { value: unknown; labels?: Record<string, string> }) {
  const { tr } = useI18n();
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? tr('是') : tr('否')}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span className="detail-text">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="detail-list">{value.map((item, index) => <li key={index}><DetailValue value={item} labels={labels} /></li>)}</ol> : <span className="muted">{tr('空列表')}</span>;
  if (typeof value === 'object') return <DetailFields values={value as JsonObject} labels={labels} />;
  return <span>{String(value)}</span>;
}

function DetailFields({ values, labels = {} }: { values: JsonObject; labels?: Record<string, string> }) {
  const { tr } = useI18n();
  const entries = Object.entries(values);
  const knownLabels: Record<string, string> = { userName: tr('用户昵称'), promptTokens: tr('输入 token'), completionTokens: tr('输出 token'), cachedPromptTokens: tr('缓存输入 token'), inputCharacters: tr('输入字符数'), conversationType: tr('会话类型'), messageId: tr('消息 ID'), seq: tr('发送序号') };
  return entries.length ? <dl className="detail-fields">{entries.map(([key, value]) => <div key={key}><dt>{labels[key] ?? knownLabels[key] ?? key}</dt><dd><DetailValue value={value} labels={labels} /></dd></div>)}</dl> : <span className="muted">{tr('没有详情字段')}</span>;
}

function LibraryPanel({ kind, data, onRefresh, onError }: { kind: LibraryKind; data: LibraryRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { language, tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
      config: {
        prompt: '', content: '', url: '',
        ...(editing?.config ?? {}),
        allowedTools: editing?.config.allowedTools ?? editing?.config.tools ?? [],
        authToken: '',
      },
    });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; description?: string; enabled: boolean; config?: JsonObject }) => {
    setSaving(true);
    try {
      const fields = kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content'];
      const config = { ...(editing?.config ?? {}) };
      for (const key of fields) {
        const value = values.config?.[key];
        if (key === 'authToken' && !value) continue;
        config[key] = value ?? (key === 'allowedTools' ? [] : '');
      }
      await api.saveLibrary(kind, {
        name: values.name,
        description: values.description ?? '',
        enabled: values.enabled,
        config,
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<LibraryRecord> = [
    { title: tr('能力字段'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ToolOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('说明'), dataIndex: 'description', key: 'description', render: (value: string) => value || '—' },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveLibrary(kind, { ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteLibrary(kind, row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun={libraryNames[kind].toUpperCase()} action={`${tr('新增')} ${libraryNames[kind]}`} onCreate={() => drawer.edit()} />
    {data.length ? <Table<LibraryRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={`${tr('还没有')} ${libraryNames[kind]}`} description={`${tr('添加')} ${libraryNames[kind]}${tr('，再按群聊策略选择启用范围。')}`} onCreate={() => drawer.edit()} action={`${tr('新增')} ${libraryNames[kind]}`} />}
    <Drawer title={<DrawerTitle label={`${kind.toUpperCase()} / LIBRARY`} title={editing ? `${tr('编辑')} ${libraryNames[kind]}` : `${tr('新增')} ${libraryNames[kind]}`} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="description" label={tr('说明')}><Input.TextArea rows={3} /></Form.Item>
        <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('能力配置')}</span><small>{libraryNames[kind]}</small></div>
          {kind === 'skills' && <Form.Item name={['config', 'prompt']} label={tr('Skill 提示词')} extra={tr('为模型说明何时使用此能力，以及如何执行。')}><Input.TextArea rows={5} /></Form.Item>}
          {kind !== 'mcps' && <Form.Item name={['config', 'content']} label={kind === 'rules' ? tr('规则内容') : tr('Skill 内容')} extra={kind === 'rules' ? tr('规则将作为群聊模型上下文的一部分。') : tr('能力的详细步骤或参考内容，不需要填写 JSON。')}><Input.TextArea rows={7} /></Form.Item>}
          {kind === 'mcps' && <>
            <Form.Item name={['config', 'url']} label={tr('MCP 服务地址')} extra={tr('填写支持 HTTP 的 MCP 服务端点。')} rules={[{ required: true, message: tr('请输入有效 URL') }, { type: 'url', message: tr('请输入有效 URL') }]}><Input /></Form.Item>
            <Form.Item name={['config', 'authToken']} label={tr('MCP 访问令牌')} extra={tr('可选。令牌由服务端保存；编辑时留空保持原值。')}><Input.Password autoComplete="new-password" placeholder={editing ? tr('留空保持现有值') : undefined} /></Form.Item>
            <Form.Item name={['config', 'allowedTools']} label={tr('允许的 MCP 工具')} extra={tr('输入工具名称并按 Enter 添加；留空允许该服务的全部工具。')}><Select mode="tags" tokenSeparators={[',', '，', ' ']} /></Form.Item>
          </>}
          {editing && Object.keys(editing.config).some((key) => !(kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content']).includes(key)) && <details className="legacy-fields"><summary>{tr('已有扩展字段（保存时保留）')}</summary><DetailFields values={Object.fromEntries(Object.entries(editing.config).filter(([key]) => !(kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content']).includes(key)))} /></details>}
        </div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function logFieldValue(row: ConversationLog, key: string): unknown {
  const direct = (row as unknown as JsonObject)[key];
  if (direct !== undefined) return direct;
  let value: unknown = row.details;
  for (const part of key.replace(/^details\./, '').split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as JsonObject)[part];
  }
  return value;
}

function logErrorText(row: ConversationLog): string {
  const details = row.details ?? {};
  const value = details.error ?? details.message ?? details.detail;
  if (typeof value === 'string') return value;
  if (value !== undefined) return JSON.stringify(value);
  return '';
}

function logErrorCode(row: ConversationLog): string | undefined {
  const details = row.details ?? {};
  for (const key of ['errorCode', 'code', 'statusCode', 'httpStatus']) {
    const value = details[key];
    if (typeof value === 'number' || typeof value === 'string' && value.trim()) return String(value).trim();
  }
  return /(?:^|\D)([1-5]\d{2})(?:\D|$)/.exec(logErrorText(row))?.[1];
}

function CopyId({ value, label }: { value?: string; label: string }) {
  const { tr } = useI18n();
  const { message } = AntApp.useApp();
  if (!value) return <span className="muted">—</span>;
  const short = value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(tr('已复制'));
    } catch {
      message.error(tr('复制失败，请手动选择文本'));
    }
  };
  return <span className="copy-id"><Tooltip title={<span className="table-mono">{value}</span>}><span className="copy-id-short">{short}</span></Tooltip><Tooltip title={tr('复制 openid')}><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`${tr('复制')} ${label}`} onClick={() => void copy()} /></Tooltip></span>;
}

function LogsPage({ data, total, enabled, plugins, accounts, groups, page, onPage, form, onFilter, onCleared }: {
  data: ConversationLog[]; total: number; enabled: boolean | null; plugins: PluginRecord[]; accounts: BotAccountRecord[]; groups: GroupRecord[]; page: number; onPage: (value: number) => void; form: FormInstance<LogFilters>; onFilter: (values: LogFilters) => void; onCleared: () => void;
}) {
  const { language, tr, localized } = useI18n();
  const { message } = AntApp.useApp();
  const [clearing, setClearing] = useState(false);
  const [errorRow, setErrorRow] = useState<ConversationLog | null>(null);
  const clearLogs = async () => {
    setClearing(true);
    try {
      const result = await api.clearLogs();
      message.success(`${tr('已清除日志')}：${result.cleared ?? 0}`);
      onCleared();
    } catch (reason) { message.error(formatError(reason)); }
    finally { setClearing(false); }
  };
  const selectedPluginId = Form.useWatch('pluginId', { form, preserve: true }) as string | undefined;
  const rowPlugin = (row: ConversationLog) => plugins.find((item) => item.id === (row.pluginId || accounts.find((account) => account.id === row.accountId)?.pluginId));
  const rowDefinition = (row: ConversationLog) => pluginDefinition(row.pluginType || rowPlugin(row)?.type);
  const selectedDefinition = pluginDefinition(plugins.find((item) => item.id === selectedPluginId)?.type);
  const fields = new Map<string, { key: string; label: { zh: string; en: string } }>();
  for (const definition of selectedDefinition ? [selectedDefinition] : data.map(rowDefinition)) {
    for (const field of definition?.logFields ?? []) fields.set(field.key, field);
  }
  const label = (key: string, fallback: string) => fields.has(key) ? localized(fields.get(key)!.label) : tr(fallback);
  const columns: TableColumnsType<ConversationLog> = [
    { title: label('createdAt', '时间'), dataIndex: 'createdAt', key: 'createdAt', width: 150, render: (value: number) => prettyDate(value, language) },
    { title: label('status', '处理状态'), key: 'status', width: 90, render: (_, row) => <Tag color={row.status === 'error' || row.status === 'failed' ? 'error' : row.status === 'success' || row.status === 'sent' ? 'success' : 'default'}>{row.status ? tr(({ success: '成功', sent: '已发出', received: '已收到', error: '错误', failed: '失败', skipped: '已跳过', rejected: '已拒绝', processing: '处理中', completed: '已完成' } as Record<string, string>)[row.status] ?? row.status) : row.direction === 'in' ? tr('收到') : tr('发出')}</Tag> },
    { title: tr('会话'), key: 'group', width: 130, render: (_, row) => {
      const group = groups.find((item) => item.id === row.groupId);
      return <div className="log-group-cell"><strong>{group?.name || tr('未知会话')}</strong><small>{group?.conversationType === 'private' ? tr('私聊') : tr('群聊')}</small></div>;
    } },
    { title: label('userId', '用户 openid'), dataIndex: 'userId', key: 'userId', width: 125, render: (value: unknown) => <CopyId value={typeof value === 'string' ? value : undefined} label="user openid" /> },
    { title: tr('总费用（USD）'), key: 'cost', align: 'right', width: 130, render: (_, row) => {
      const charges = Array.isArray(row.details?.charges) ? row.details.charges as Array<{ cost?: number; model?: string; usage?: unknown; pricingSource?: string; estimated?: boolean }> : [];
      const amount = row.details?.cost;
      if (typeof amount !== 'number') return <span className="muted">—</span>;
      return <Tooltip title={<div className="cost-tooltip">{charges.length ? charges.map((charge, index) => <div key={index}>{charge.model || tr('模型')} · ${Number(charge.cost ?? 0).toFixed(6)} · {charge.pricingSource || tr('来源未提供')}{charge.estimated && ` · ${tr('估算，可能低估')}`}<br />{tr('用量')}：{charge.usage ? JSON.stringify(charge.usage) : '—'}</div>) : <span>{tr('来源未提供')}</span>}</div>}><span className="table-mono">${amount.toFixed(6)}{charges.some((charge) => charge.estimated) && <Tag color="warning">{tr('估算')}</Tag>}</span></Tooltip>;
    } },
    { title: label('content', '收到内容'), dataIndex: 'content', key: 'content', render: (value: unknown) => <div className="log-content"><DetailValue value={value} /></div> },
    { title: label('reply', '发送内容'), key: 'reply', render: (_, row) => <div className="log-content"><DetailValue value={logFieldValue(row, 'details.reply')} /></div> },
    { title: tr('错误'), key: 'error', width: 96, render: (_, row) => {
      const error = logErrorText(row);
      if (!error) return <span className="muted">—</span>;
      const code = logErrorCode(row);
      return <Tooltip title={tr('查看错误详情')}><Button type="text" danger size="small" className="log-error-button" icon={<ExclamationCircleOutlined />} onClick={() => setErrorRow(row)}>{code ? `API ${code}` : tr('错误')}</Button></Tooltip>;
    } },
  ];
  const errorText = errorRow ? logErrorText(errorRow) : '';
  const errorCode = errorRow ? logErrorCode(errorRow) : undefined;
  const errorDetails: JsonObject = errorRow ? {
    ...(errorRow.details ?? {}),
    eventId: errorRow.eventId,
    pluginId: errorRow.pluginId,
    accountId: errorRow.accountId,
    groupId: errorRow.groupId,
    groupExternalId: errorRow.groupExternalId,
    userId: errorRow.userId,
  } : {};
  delete errorDetails.error;
  if (enabled === false) return <section className="logs-disabled"><div className="disabled-icon"><MessageOutlined /></div><div className="eyebrow"><span className="eyebrow-line" /> OBSERVABILITY / DISABLED</div><Title level={2}>{tr('对话日志已关闭')}</Title><Paragraph>{tr('服务端未启用 LOG_RECORD。如需记录对话，请在部署环境启用该配置；现有日志保留策略为 30 天。')}</Paragraph><div className="disabled-meta"><span>LOG_RECORD</span><b>OFF</b><span>RETENTION</span><b>30 DAYS</b></div></section>;
  return <section className="data-page logs-page">
    <div className="log-toolbar"><Form form={form} layout="inline" onFinish={onFilter} className="log-filter-form">
      <Form.Item name="q"><Input allowClear prefix={<MessageOutlined />} placeholder={tr('搜索消息内容或用户 ID')} aria-label={tr('搜索消息内容或用户 ID')} /></Form.Item>
      <Form.Item name="pluginId"><Select allowClear placeholder={tr('全部插件')} aria-label={tr('全部插件')} options={plugins.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
      <Form.Item name="openid"><Input allowClear placeholder={tr('用户或群 openid')} aria-label={tr('用户或群 openid')} /></Form.Item>
      <Form.Item name="from"><Input type="datetime-local" aria-label={tr('开始时间')} /></Form.Item>
      <Form.Item name="to"><Input type="datetime-local" aria-label={tr('结束时间')} /></Form.Item>
      <Form.Item name="accountId"><Select allowClear placeholder={tr('全部账号')} options={accounts.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
      <Form.Item name="groupId"><Select allowClear placeholder={tr('全部群聊')} options={groups.map((item) => ({ label: item.name || item.externalId, value: item.id }))} /></Form.Item>
    </Form><Space className="log-actions" size={8} wrap={false}>
      <Button size="small" type="primary" onClick={() => form.submit()}>{tr('应用筛选')}</Button>
      <Button size="small" onClick={() => { form.resetFields(); onFilter({}); }}>{tr('重置')}</Button>
      <Popconfirm title={tr('清除全部对话日志？')} description={tr('将删除所有对话日志记录，且无法恢复。')} okText={tr('清除')} cancelText={tr('取消')} okButtonProps={{ danger: true }} onConfirm={() => void clearLogs()}>
        <Button size="small" danger loading={clearing} disabled={!total} icon={<DeleteOutlined />}>{tr('清除日志')}</Button>
      </Popconfirm>
    </Space></div>
    {data.length ? <><Table<ConversationLog> rowKey="id" columns={columns} dataSource={data} pagination={false} scroll={{ x: 1050 }} className="data-table logs-table" /><div className="logs-pagination"><span>{language === 'en' ? `Page ${page} of ${Math.max(1, Math.ceil(total / 20))}` : `第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / 20))} 页`} · {total} RECORDS / 30D</span><Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={onPage} /></div></> : <EmptyTable title={tr('没有匹配的对话记录')} description={tr('尝试调整筛选条件，或确认服务端日志记录已启用。')} />}
    <Modal open={Boolean(errorRow)} title={tr('错误详情')} width={760} onCancel={() => setErrorRow(null)}
      footer={<Space><Button icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(errorText).then(() => message.success(tr('已复制'))).catch(() => message.error(tr('复制失败，请手动选择文本'))); }}>{tr('复制错误')}</Button><Button type="primary" onClick={() => setErrorRow(null)}>{tr('关闭')}</Button></Space>}>
      {errorRow && <div className="log-error-detail">
        <div className="log-error-code"><span>{tr('错误代码')}</span><Tag color={errorCode ? 'error' : 'default'}>{errorCode ?? tr('未提供')}</Tag><span className="muted">{errorRow.status}</span></div>
        <h3>{tr('错误内容')}</h3>
        <pre className="log-error-message">{errorText || tr('无错误文本')}</pre>
        <h3>{tr('详细信息')}</h3>
        <DetailFields values={errorDetails} labels={{ eventId: tr('事件 ID'), messageId: tr('消息 ID'), pluginId: tr('插件'), accountId: tr('账号'), groupId: tr('群聊'), groupExternalId: tr('群 openid'), userId: tr('用户 openid'), model: tr('模型'), providerId: tr('AI供应商') }} />
      </div>}
    </Modal>
  </section>;
}

function DrawerTitle({ label, title }: { label: string; title: string }) {
  return <div className="drawer-title"><span>{label}</span><strong>{title}</strong></div>;
}

function RoutedApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'error'>('checking');
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (route.kind !== 'admin') return;
    let active = true;
    setAuthState('checking');
    setAuthError('');
    api.me().then((result) => {
      if (!active) return;
      if (result.authenticated !== true) {
        setAuthState('error');
        go('/login');
      } else setAuthState('authenticated');
    }).catch((reason) => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) {
        setAuthState('error');
        go('/login');
      } else {
        setAuthError(formatError(reason));
        setAuthState('error');
      }
    });
    return () => { active = false; };
  }, [route.kind]);
  const loginSuccess = () => { setAuthState('authenticated'); go('/admin/overview'); };
  const logout = () => { setAuthState('checking'); go('/login'); };

  if (route.kind === 'home') return <LandingPage />;
  if (route.kind === 'login') return <LoginPage onSuccess={loginSuccess} />;
  if (route.kind === 'setup') return <SetupPage />;
  if (authState === 'checking') return <div className="auth-check"><Spin /><span>正在验证管理员会话…</span></div>;
  if (authState === 'error') return <main className="auth-error"><BrandMark /><Alert type="error" showIcon message="无法验证管理员会话" description={authError || '请重新登录后再试。'} action={<Button type="primary" href="#/login">前往登录</Button>} /><Button type="link" href="#/">返回首页</Button></main>;
  return <AdminConsole key={route.page} page={route.page} onLogout={logout} />;
}

function ThemedApp() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? '#78cfc3' : '#0f8a7c',
          colorInfo: dark ? '#78cfc3' : '#0f8a7c',
          colorSuccess: dark ? '#78cfc3' : '#0f8a7c',
          colorBgBase: dark ? '#101619' : '#f4f7f6',
          colorBgContainer: dark ? '#171f22' : '#ffffff',
          colorBgElevated: dark ? '#202a2d' : '#ffffff',
          colorText: dark ? '#e6ecea' : '#16201e',
          colorTextSecondary: dark ? '#a1b0ae' : '#5c6b67',
          colorBorder: dark ? '#303d40' : '#d5dfdc',
          borderRadius: 3,
          fontFamily: '"IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif',
          controlHeight: 38,
        },
      }}
    >
      <AntApp><RoutedApp /></AntApp>
    </ConfigProvider>
  );
}

export default function App() {
  return <ThemeProvider><LanguageProvider><ThemedApp /></LanguageProvider></ThemeProvider>;
}
