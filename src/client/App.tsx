import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
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
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  GithubOutlined,
  LoginOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MessageOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
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
  PluginFieldDefinition,
  PluginRecord,
  ProviderRecord,
} from '../shared/types';
import {
  defaultFieldValues,
  normalizeFieldValues,
  pluginDefinition,
  pluginDefinitions,
} from '../shared/plugin-catalog';
import { LanguageProvider, useI18n } from './i18n';
import { ApiError, api } from './api';

const { Title, Text, Paragraph } = Typography;
const { Sider, Content } = Layout;

type AdminPage = 'overview' | 'plugins' | 'accounts' | 'groups' | 'integrations' | 'logs';
type Route = { kind: 'home' } | { kind: 'login' } | { kind: 'setup' } | { kind: 'admin'; page: AdminPage };
type LibraryData = Record<LibraryKind, LibraryRecord[]>;
type LogFilters = { q?: string; accountId?: string; groupId?: string; from?: string; to?: string };

const libraryNames: Record<LibraryKind, string> = { skills: 'Skills', mcps: 'MCP', rules: 'Rules' };
const pageTitles: Record<AdminPage, { title: string; eyebrow: string; description: string }> = {
  overview: { title: '运行总览', eyebrow: 'CONTROL ROOM / 01', description: '查看 Bot 实例、群聊与扩展能力的当前配置。' },
  plugins: { title: '插件管理', eyebrow: 'RUNTIME / 02', description: '管理已注册的 TypeScript 插件及其运行状态。' },
  accounts: { title: '平台账号', eyebrow: 'INSTANCES / 03', description: '为同一插件配置多个平台实例与鉴权参数。' },
  groups: { title: '群聊策略', eyebrow: 'POLICIES / 04', description: '逐群设置模型、回复策略、白名单与扩展能力。' },
  integrations: { title: '接口能力', eyebrow: 'CONNECTORS / 05', description: '配置 OpenAI 兼容模型供应商，以及 Skills、MCP 和 Rules。' },
  logs: { title: '对话日志', eyebrow: 'OBSERVABILITY / 06', description: '筛选近期对话记录。日志受服务端 LOG_RECORD 配置控制。' },
};

function currentRoute(): Route {
  const path = window.location.hash.slice(1);
  if (path) {
    if (path === '/setup') return { kind: 'setup' };
    if (path === '/login') return { kind: 'login' };
    if (path.startsWith('/admin')) {
      const page = path.split('/')[2] as AdminPage | undefined;
      const valid: AdminPage[] = ['overview', 'plugins', 'accounts', 'groups', 'integrations', 'logs'];
      return { kind: 'admin', page: valid.includes(page as AdminPage) ? page as AdminPage : 'overview' };
    }
    return { kind: 'home' };
  }
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return pathname === '/setup' ? { kind: 'setup' } : { kind: 'home' };
}

function go(path: string) {
  window.location.hash = path;
}

function prettyDate(value?: string | number) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function parseTimestamp(value?: string) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

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

function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <a className="brand-link" href="#/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <nav className="landing-nav" aria-label="主导航">
          <a href="#features">平台能力</a>
          <a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer">源代码 <ArrowUpOutlined /></a>
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
      <header className="login-header"><a className="brand-link" href="#/"><BrandMark /></a><a href="#/" className="back-link">返回首页 <ArrowRightOutlined /></a></header>
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
  const [form] = Form.useForm<{ token: string }>();
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const ready = status?.schemaReady === true;
  const connected = status?.databaseConfigured === true;

  return (
    <main className="login-shell setup-shell">
      <header className="login-header">
        <a className="brand-link" href="/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <a href="#/login" className="back-link">管理员登录 <ArrowRightOutlined /></a>
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
          <div className="login-footnote"><span className="online-dot" /> DATABASE / D1 <span>REFRESH TO RECHECK</span></div>
        </section>
      </div>
      <footer className="login-footer"><span>NONEBOTMAKER / DATABASE BOOTSTRAP</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> GITHUB</a></footer>
    </main>
  );
}

function AdminConsole({ page, onLogout }: { page: AdminPage; onLogout: () => void }) {
  const { message } = AntApp.useApp();
  const { language, setLanguage, tr } = useI18n();
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [accounts, setAccounts] = useState<BotAccountRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [libraries, setLibraries] = useState<LibraryData>({ skills: [], mcps: [], rules: [] });
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
            const [pluginData, accountData, groupData, providerData] = await Promise.all([
              api.listPlugins(), api.listAccounts(), api.listGroups(), api.listProviders(),
            ]);
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData); setGroups(groupData); setProviders(providerData);
            break;
          }
          case 'plugins': setPlugins(await api.listPlugins()); break;
          case 'accounts': {
            const [pluginData, accountData] = await Promise.all([api.listPlugins(), api.listAccounts()]);
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData);
            break;
          }
          case 'groups': {
            const [groupData, accountData, providerData, skillData, mcpData, ruleData] = await Promise.all([
              api.listGroups(), api.listAccounts(), api.listProviders(),
              api.listLibraries('skills'), api.listLibraries('mcps'), api.listLibraries('rules'),
            ]);
            if (!active) return;
            setGroups(groupData); setAccounts(accountData); setProviders(providerData);
            setLibraries({ skills: skillData, mcps: mcpData, rules: ruleData });
            break;
          }
          case 'integrations': {
            const [providerData, skillData, mcpData, ruleData] = await Promise.all([
              api.listProviders(), api.listLibraries('skills'), api.listLibraries('mcps'), api.listLibraries('rules'),
            ]);
            if (!active) return;
            setProviders(providerData); setLibraries({ skills: skillData, mcps: mcpData, rules: ruleData });
            break;
          }
          case 'logs': {
            const [result, accountData, groupData] = await Promise.all([
              api.listLogs({
                page: logPage,
                pageSize: 20,
                q: logFilters.q,
                accountId: logFilters.accountId,
                groupId: logFilters.groupId,
                from: parseTimestamp(logFilters.from),
                to: parseTimestamp(logFilters.to),
              }), api.listAccounts(), api.listGroups(),
            ]);
            if (!active) return;
            setLogs(result.items); setLogsTotal(result.total); setLogsEnabled(result.enabled); setAccounts(accountData); setGroups(groupData);
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
  }, [page, refreshKey, logPage, logFilters]);

  const navItems = [
    { key: 'overview', icon: <BookOutlined />, label: tr('运行总览') },
    { key: 'plugins', icon: <CodeOutlined />, label: tr('插件管理') },
    { key: 'accounts', icon: <RobotOutlined />, label: tr('平台账号') },
    { key: 'groups', icon: <TeamOutlined />, label: tr('群聊策略') },
    { key: 'integrations', icon: <ApiOutlined />, label: tr('接口能力') },
    { key: 'logs', icon: <MessageOutlined />, label: tr('对话日志') },
  ];
  const title = pageTitles[page];
  const setPage = (key: string) => {
    setMobileNav(false);
    go(`/admin/${key}`);
  };
  const runAction = async (operation: () => Promise<unknown>) => {
    setActionError('');
    try {
      await operation();
      refresh();
    } catch (reason) {
      handleError(reason);
    }
  };
  const logout = async () => {
    try { await api.logout(); } catch (reason) { handleError(reason); }
    onLogout();
  };

  return (
    <Layout className="admin-layout">
      <Sider className={`admin-sider${mobileNav ? ' admin-sider-open' : ''}`} width={252} theme="dark" aria-label={tr('管理台导航')}>
        <a className="sider-brand" href="#/admin/overview"><BrandMark /></a>
        <div className="workspace-label"><span className="workspace-dot" /> LOCAL CONTROL PLANE</div>
        <Menu mode="inline" selectedKeys={[page]} items={navItems} onClick={({ key }) => setPage(key)} className="admin-menu" />
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
              {page === 'overview' && <OverviewPage plugins={plugins} accounts={accounts} groups={groups} providers={providers} onNavigate={setPage} />}
              {page === 'plugins' && <PluginsPage data={plugins} onRefresh={refresh} onError={handleError} />}
              {page === 'accounts' && <AccountsPage plugins={plugins} data={accounts} onRefresh={refresh} onError={handleError} />}
              {page === 'groups' && <GroupsPage groups={groups} accounts={accounts} providers={providers} libraries={libraries} onRefresh={refresh} onError={handleError} />}
              {page === 'integrations' && <IntegrationsPage providers={providers} libraries={libraries} onRefresh={refresh} onError={handleError} />}
              {page === 'logs' && <LogsPage data={logs} total={logsTotal} enabled={logsEnabled} accounts={accounts} groups={groups} page={logPage} onPage={setLogPage} form={filterForm} onFilter={(values) => { setLogPage(1); setLogFilters(values); }} />}
            </>
          )}
          <footer className="content-footer"><span>EDGE CONFIGURATION / NONEBOTMAKER</span><span>SESSION ISOLATED <i /></span></footer>
        </Content>
      </Layout>
    </Layout>
  );
}

function OverviewPage({ plugins, accounts, groups, providers, onNavigate }: {
  plugins: PluginRecord[]; accounts: BotAccountRecord[]; groups: GroupRecord[]; providers: ProviderRecord[]; onNavigate: (page: string) => void;
}) {
  const { tr } = useI18n();
  const activeAccounts = accounts.filter((item) => item.enabled).length;
  const activeGroups = groups.filter((item) => item.enabled).length;
  const activePlugins = plugins.filter((item) => item.enabled).length;
  return (
    <div className="overview-page">
      <section className="overview-banner">
        <div><span className="banner-label"><span className="online-dot" /> CONFIGURATION PLANE / ONLINE</span><h2>{tr('一眼掌握运行边界。')}</h2><p>{tr('数据直接读取当前管理 API；新增和修改配置后将以服务端结果为准。')}</p></div>
        <div className="banner-code"><span>ENVIRONMENT</span><strong>EDGE / SERVERLESS</strong><span>CONTROL MODEL</span><strong>PLUGIN → ACCOUNT → GROUP</strong></div>
      </section>
      <div className="metric-grid">
        <MetricTile index="01" label={tr('启用插件')} value={activePlugins} total={plugins.length} icon={<CodeOutlined />} onClick={() => onNavigate('plugins')} />
        <MetricTile index="02" label={tr('运行账号')} value={activeAccounts} total={accounts.length} icon={<RobotOutlined />} onClick={() => onNavigate('accounts')} />
        <MetricTile index="03" label={tr('启用群聊')} value={activeGroups} total={groups.length} icon={<TeamOutlined />} onClick={() => onNavigate('groups')} />
        <MetricTile index="04" label={tr('模型供应商')} value={providers.filter((item) => item.enabled).length} total={providers.length} icon={<ApiOutlined />} onClick={() => onNavigate('integrations')} />
      </div>
      <div className="overview-columns">
        <Card className="section-card overview-flow" title={<SectionTitle index="A" title={tr('配置拓扑')} subtitle="CONFIGURATION GRAPH" />} extra={<Button type="link" onClick={() => onNavigate('groups')}>{tr('管理群聊')} <ArrowRightOutlined /></Button>}>
          <div className="flow-row"><span className="flow-icon"><CodeOutlined /></span><div><strong>{tr('插件')}</strong><small>{tr('逻辑与接入协议')}</small></div><b>{plugins.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><RobotOutlined /></span><div><strong>{tr('账号')}</strong><small>{tr('平台机器人实例')}</small></div><b>{accounts.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><TeamOutlined /></span><div><strong>{tr('群聊')}</strong><small>{tr('按群独立策略')}</small></div><b>{groups.length.toString().padStart(2, '0')}</b></div>
          <div className="flow-caption"><span>PLUGIN</span><i /><span>MULTI-ACCOUNT</span><i /><span>GROUP POLICY</span></div>
        </Card>
        <Card className="section-card overview-quick" title={<SectionTitle index="B" title={tr('快捷操作')} subtitle="CONTROL SHORTCUTS" />}>
          <button className="quick-row" onClick={() => onNavigate('plugins')}><span><CodeOutlined /></span><div><strong>{tr('检查插件运行状态')}</strong><small>{tr('查看已注册插件与启停配置')}</small></div><ArrowRightOutlined /></button>
          <button className="quick-row" onClick={() => onNavigate('accounts')}><span><PlusOutlined /></span><div><strong>{tr('添加机器人实例')}</strong><small>{tr('创建账号并关联现有插件')}</small></div><ArrowRightOutlined /></button>
          <button className="quick-row" onClick={() => onNavigate('integrations')}><span><SettingOutlined /></span><div><strong>{tr('配置模型与工具')}</strong><small>{tr('供应商、Skills、MCP、Rules')}</small></div><ArrowRightOutlined /></button>
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
      rules={field.required && !editing ? [{ required: true, message: tr('此字段为必填项') }] : undefined}
    >
      <PluginFieldInput field={field} editing={editing} />
    </Form.Item>
  );
}

function PluginsPage({ data, onRefresh, onError }: { data: PluginRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr, localized } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const selectedType = (Form.useWatch('type', form) as string | undefined) ?? editing?.type ?? CHATBOT_PLUGIN_TYPE;
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

  const initialConfig = useMemo(() => {
    const config = {
      ...defaultFieldValues(pluginDefinition(editing?.type)?.configFields ?? []),
      ...(editing?.config ?? {}),
    };
    if (editing) {
      for (const field of configFields) {
        if (field.secret) config[field.key] = '';
      }
    }
    return config;
  }, [editing, configFields]);

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
      const config = currentDefinition
        ? normalizeFieldValues(currentDefinition.configFields, values.config)
        : values.config ?? {};
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
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: prettyDate },
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
        <Form.Item name="type" label={tr('插件类型')} rules={[{ required: true, message: tr('请输入插件类型') }]}><Select options={typeOptions} placeholder={CHATBOT_PLUGIN_TYPE} /></Form.Item>
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
  const selectedPluginId = Form.useWatch('pluginId', form) as string | undefined;
  const selectedPlugin = plugins.find((item) => item.id === selectedPluginId);
  const definition = pluginDefinition(selectedPlugin?.type);
  const credentialFields = definition?.credentialFields ?? [];
  useEffect(() => {
    if (!drawer.open) return;
    form.setFieldsValue({
      pluginId: editing?.pluginId,
      protocol: editing?.protocol ?? '',
      name: editing?.name ?? '',
      enabled: editing?.enabled ?? true,
      credentials: {},
    });
  }, [drawer.open, editing, form]);
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
        config: editing?.config ?? {},
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
        <Form.Item name="pluginId" label={tr('关联插件')} rules={[{ required: true, message: tr('请选择插件') }]}><Select placeholder={tr('选择插件')} options={plugins.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
        {!plugins.length && <Alert type="warning" showIcon message={tr('当前没有插件记录，请先创建插件。')} />}
        <Form.Item name="protocol" label={tr('平台协议')}><Input placeholder={tr('例如：qq / discord')} /></Form.Item>
        {credentialFields.length ? <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('账号字段')}</span><small>{definition?.type} / {credentialFields.length} FIELDS</small></div>
          {credentialFields.map((field) => <PluginField key={field.key} field={field} path={['credentials', field.key]} editing={Boolean(editing)} />)}
          {editing && <p className="form-note">{tr('敏感字段留空会保留现有值。')}</p>}
        </div> : <Alert type="info" showIcon message={tr('该插件类型没有声明账号字段。')} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function GroupsPage({ groups, accounts, providers, libraries, onRefresh, onError }: {
  groups: GroupRecord[]; accounts: BotAccountRecord[]; providers: ProviderRecord[]; libraries: LibraryData; onRefresh: () => void; onError: (error: unknown) => void;
}) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = groups.find((item) => item.id === drawer.editingId);
  const providerId = Form.useWatch('providerId', form) as string | undefined;
  const provider = providers.find((item) => item.id === providerId);
  useEffect(() => {
    if (!drawer.open) return;
    form.setFieldsValue({ accountId: editing?.accountId, externalId: editing?.externalId ?? '', name: editing?.name ?? '', enabled: editing?.enabled ?? true, providerId: editing?.providerId, model: editing?.model ?? undefined, systemPrompt: editing?.systemPrompt ?? '', reasoningEffort: editing?.reasoningEffort ?? 'medium', nonMentionReplyRate: editing?.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE, whitelistEnabled: editing?.whitelistEnabled ?? false, whitelistUserIds: editing?.whitelistUserIds ?? [], whitelistText: editing?.whitelistUserIds.join('\n') ?? '', inputCostPerMillion: editing?.inputCostPerMillion ?? 0, outputCostPerMillion: editing?.outputCostPerMillion ?? 0, dailyCostLimit: editing?.dailyCostLimit ?? 0, monthlyCostLimit: editing?.monthlyCostLimit ?? 0, totalCostLimit: editing?.totalCostLimit ?? 0, skillIds: editing?.skillIds ?? [], mcpIds: editing?.mcpIds ?? [], ruleIds: editing?.ruleIds ?? [] });
  }, [drawer.open, editing, form]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const userIds = typeof values.whitelistText === 'string' ? values.whitelistText.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean) : values.whitelistUserIds as string[] ?? [];
      await api.saveGroup({
        accountId: String(values.accountId), externalId: String(values.externalId), name: String(values.name ?? ''), enabled: Boolean(values.enabled), providerId: String(values.providerId ?? ''), model: String(values.model ?? ''), systemPrompt: String(values.systemPrompt ?? ''), reasoningEffort: values.reasoningEffort as GroupRecord['reasoningEffort'], nonMentionReplyRate: Number(values.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE), whitelistEnabled: Boolean(values.whitelistEnabled), whitelistUserIds: userIds, inputCostPerMillion: Number(values.inputCostPerMillion ?? 0), outputCostPerMillion: Number(values.outputCostPerMillion ?? 0), dailyCostLimit: Number(values.dailyCostLimit ?? 0), monthlyCostLimit: Number(values.monthlyCostLimit ?? 0), totalCostLimit: Number(values.totalCostLimit ?? 0), skillIds: values.skillIds as string[] ?? [], mcpIds: values.mcpIds as string[] ?? [], ruleIds: values.ruleIds as string[] ?? [],
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<GroupRecord> = [
    { title: tr('群聊'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><TeamOutlined /></span><span><strong>{name || row.externalId}</strong><small>{row.externalId} / {row.id}</small></span></div> },
    { title: tr('账号'), dataIndex: 'accountId', key: 'accountId', render: (id: string) => accounts.find((item) => item.id === id)?.name ?? id },
    { title: tr('模型'), dataIndex: 'model', key: 'model', render: (model: string, row) => <span className="model-cell">{model || tr('未配置')}<small>{providers.find((item) => item.id === row.providerId)?.name ?? ''}</small></span> },
    { title: tr('非 @ 回复率'), dataIndex: 'nonMentionReplyRate', key: 'nonMentionReplyRate', render: (value: number) => <span className="table-mono">{((value ?? DEFAULT_NON_MENTION_REPLY_RATE) * 100).toFixed(0)}%</span> },
    { title: tr('白名单'), dataIndex: 'whitelistEnabled', key: 'whitelistEnabled', render: (enabled: boolean, row) => <span>{enabled ? `${tr('启用')} / ${row.whitelistUserIds.length}` : tr('未启用')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name || row.externalId}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveGroup({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name || row.externalId}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteGroup(row.id).then(onRefresh).catch(onError)}><Button aria-label={tr('删除')} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  const choices = (kind: LibraryKind) => libraries[kind].filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }));
  return <section className="data-page"><PageToolbar count={groups.length} noun="GROUP POLICIES" action={tr('新增群聊策略')} onCreate={() => drawer.edit()} />
    {groups.length ? <Table<GroupRecord> rowKey="id" columns={columns} dataSource={groups} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1050 }} className="data-table" /> : <EmptyTable title={tr('还没有群聊策略')} description={tr('新增群聊并为其绑定 AI 模型、回复策略和工具。')} onCreate={() => drawer.edit()} action={tr('新增群聊策略')} />}
    <Drawer title={<DrawerTitle label="GROUP POLICY" title={editing ? tr('编辑群聊策略') : tr('新增群聊策略')} />} width={660} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存策略')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <div className="form-grid two-cols">
          <Form.Item name="accountId" label={tr('机器人账号')} rules={[{ required: true, message: tr('请选择机器人账号') }]}><Select placeholder={tr('选择账号')} options={accounts.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
          <Form.Item name="externalId" label={tr('平台群聊 ID')} rules={[{ required: true, message: tr('请输入群聊 ID') }]}><Input placeholder="123456789" /></Form.Item>
        </div>
        <Form.Item name="name" label={tr('群聊名称')}><Input placeholder={tr('可选的群聊备注名称')} /></Form.Item>
        <div className="form-section-heading"><span>AI MODEL</span><small>PER-GROUP ROUTING</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="providerId" label={tr('模型供应商')} rules={[{ required: true, message: tr('请选择模型供应商') }]}><Select placeholder={tr('选择供应商')} options={providers.filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
          <Form.Item name="model" label={tr('模型')}><AutoComplete options={provider?.models.map((model) => ({ label: model, value: model })) ?? []} placeholder={tr('选择或输入模型 ID')} filterOption /></Form.Item>
        </div>
        <Form.Item name="systemPrompt" label={tr('系统提示词')}><Input.TextArea rows={5} placeholder={tr('描述该群聊中 AI 的角色、边界与回复风格')} /></Form.Item>
        <div className="form-grid two-cols">
          <Form.Item name="reasoningEffort" label={tr('思考强度')}><Select options={[{ label: tr('低 / low'), value: 'low' }, { label: tr('中 / medium'), value: 'medium' }, { label: tr('高 / high'), value: 'high' }]} /></Form.Item>
          <Form.Item name="nonMentionReplyRate" label={tr('未 @ 回复概率')}><InputNumber className="full-width" min={0} max={1} step={0.01} precision={2} addonAfter="0–1" /></Form.Item>
        </div>
        <div className="form-note">{tr('默认值 0.05；0 表示仅在被 @ 时回复，1 表示每条消息均参与回复判定。')}</div>
        <div className="form-section-heading"><span>TOKEN PRICING</span><small>USD / 1M TOKENS</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="inputCostPerMillion" label={tr('输入成本')}><InputNumber className="full-width" min={0} precision={4} addonBefore="$" /></Form.Item>
          <Form.Item name="outputCostPerMillion" label={tr('输出成本')}><InputNumber className="full-width" min={0} precision={4} addonBefore="$" /></Form.Item>
        </div>
        <div className="form-section-heading"><span>SPENDING LIMITS</span><small>USD / 0 = UNLIMITED</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="dailyCostLimit" label={tr('每日限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
          <Form.Item name="monthlyCostLimit" label={tr('每月限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
          <Form.Item name="totalCostLimit" label={tr('总限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
        </div>
        <div className="form-note">{tr('限额使用 USD 计价；数值 0 表示不设限。任一预算到达限额后，运行时将根据策略停止额外模型请求。')}</div>
        <div className="form-section-heading"><span>ACCESS CONTROL</span><small>OPTIONAL WHITELIST</small></div>
        <Form.Item name="whitelistEnabled" label={tr('启用用户白名单')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
        <Form.Item name="whitelistText" label={tr('允许的用户 ID')} extra={tr('使用空格或逗号分隔。白名单关闭时此列表不会生效。')}><Input.TextArea rows={3} placeholder="user-id-1, user-id-2" /></Form.Item>
        <div className="form-section-heading"><span>EXTENSIONS</span><small>SKILLS / MCP / RULES</small></div>
        <Form.Item name="skillIds" label="Skills"><Select mode="multiple" placeholder={tr('选择可用 Skills')} options={choices('skills')} /></Form.Item>
        <Form.Item name="mcpIds" label="MCP"><Select mode="multiple" placeholder={tr('选择 MCP 服务')} options={choices('mcps')} /></Form.Item>
        <Form.Item name="ruleIds" label="Rules"><Select mode="multiple" placeholder={tr('选择规则集')} options={choices('rules')} /></Form.Item>
        <Form.Item name="enabled" label={tr('启用此群聊策略')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function IntegrationsPage({ providers, libraries, onRefresh, onError }: { providers: ProviderRecord[]; libraries: LibraryData; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  return <section className="data-page integrations-page"><Tabs className="integration-tabs" items={[
    { key: 'providers', label: <span><ApiOutlined /> {tr('模型供应商')} <Tag>{providers.length}</Tag></span>, children: <ProvidersPanel data={providers} onRefresh={onRefresh} onError={onError} /> },
    ...(['skills', 'mcps', 'rules'] as LibraryKind[]).map((kind) => ({ key: kind, label: <span><ToolOutlined /> {libraryNames[kind]} <Tag>{libraries[kind].length}</Tag></span>, children: <LibraryPanel kind={kind} data={libraries[kind]} onRefresh={onRefresh} onError={onError} /> })),
  ]} />
  </section>;
}

function ProvidersPanel({ data, onRefresh, onError }: { data: ProviderRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const models = Form.useWatch('models', form) as string[] | undefined;
  useEffect(() => {
    if (!drawer.open) return;
    form.setFieldsValue({ name: editing?.name ?? '', baseUrl: editing?.baseUrl ?? '', apiKey: '', enabled: editing?.enabled ?? true, models: editing?.models ?? [] });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; baseUrl: string; apiKey?: string; enabled: boolean; models?: string[] }) => {
    setSaving(true);
    try {
      await api.saveProvider({ name: values.name, baseUrl: values.baseUrl, ...(values.apiKey ? { apiKey: values.apiKey } : {}), enabled: values.enabled, models: values.models ?? [] }, editing?.id);
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
    { title: tr('密钥'), dataIndex: 'apiKey', key: 'apiKey', render: (value: string) => value ? <span className="secret-mask">••••••••</span> : <span className="muted">{tr('未配置')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑供应商')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveProvider({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除供应商')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteProvider(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun="OPENAI-COMPATIBLE PROVIDERS" action={tr('新增供应商')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<ProviderRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={tr('还没有模型供应商')} description={tr('添加 OpenAI 兼容 API，并登记可用的模型 ID。')} onCreate={() => drawer.edit()} action={tr('添加供应商')} />}
    <Drawer title={<DrawerTitle label="MODEL PROVIDER" title={editing ? tr('编辑供应商') : tr('新增供应商')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存供应商')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('供应商名称')} rules={[{ required: true, message: tr('请输入供应商名称') }]}><Input placeholder={tr('例如：团队模型网关')} /></Form.Item>
        <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true, message: tr('请输入 Base URL') }, { type: 'url', message: tr('请输入有效 URL') }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>
        <Form.Item name="apiKey" label="API Key" extra={editing ? tr('为安全起见密钥不会回显；留空表示保持现有密钥。') : tr('密钥由服务端保存，请勿分享控制台截图。')}><Input.Password autoComplete="new-password" placeholder={editing ? tr('留空以保持现有密钥') : tr('输入 API Key')} /></Form.Item>
        <Form.Item name="models" label={tr('可用模型')} extra={tr('输入模型 ID 后按 Enter 添加。')}><Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="gpt-4o-mini" /></Form.Item>
        <div className="discover-row"><Button icon={<ReloadOutlined />} loading={discovering} disabled={!editing} onClick={() => void discoverModels()}>{tr('自动获取模型')}</Button><span>{editing ? tr('通过服务端安全请求供应商 /models') : tr('请先保存供应商，再获取模型列表')}</span></div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

type ConfigEntryType = 'text' | 'number' | 'boolean';
interface ConfigEntry { key: string; type: ConfigEntryType; value: string | number | boolean }

function configEntries(config: JsonObject): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      entries.push({ key, type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text', value });
    }
  }
  return entries;
}

function configFromEntries(entries: ConfigEntry[] | undefined, previous: JsonObject): JsonObject {
  const next: JsonObject = {};
  for (const [key, value] of Object.entries(previous)) {
    if (value !== null && typeof value === 'object') next[key] = value;
  }
  for (const entry of entries ?? []) {
    const key = entry.key.trim();
    if (!key) continue;
    if (entry.type === 'boolean') next[key] = entry.value === true || entry.value === 'true' || entry.value === 1;
    else if (entry.type === 'number') {
      const parsed = Number(entry.value);
      if (Number.isFinite(parsed)) next[key] = parsed;
    } else next[key] = String(entry.value ?? '');
  }
  return next;
}

function ConfigEntryRow({ field, onRemove }: { field: { name: number; key: number }, onRemove: () => void }) {
  const { tr } = useI18n();
  const form = Form.useFormInstance();
  const type = Form.useWatch(['configEntries', field.name, 'type'], form) as ConfigEntryType | undefined;
  return (
    <div className="config-entry-row">
      <Form.Item name={[field.name, 'key']} rules={[{ required: true, message: tr('请输入键名') }]}><Input placeholder={tr('键')} /></Form.Item>
      <Form.Item name={[field.name, 'type']}><Select options={[
        { value: 'text', label: tr('文本') },
        { value: 'number', label: tr('数字') },
        { value: 'boolean', label: tr('布尔') },
      ]} /></Form.Item>
      <Form.Item name={[field.name, 'value']} valuePropName={type === 'boolean' ? 'checked' : 'value'}>
        {type === 'boolean' ? <Switch /> : type === 'number' ? <InputNumber className="full-width" /> : <Input placeholder={tr('值')} />}
      </Form.Item>
      <Button type="text" danger aria-label={tr('删除配置项')} icon={<MinusCircleOutlined />} onClick={onRemove} />
    </div>
  );
}

function LibraryPanel({ kind, data, onRefresh, onError }: { kind: LibraryKind; data: LibraryRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.setFieldsValue({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
      configEntries: configEntries(editing?.config ?? {}),
    });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; description?: string; enabled: boolean; configEntries?: ConfigEntry[] }) => {
    setSaving(true);
    try {
      await api.saveLibrary(kind, {
        name: values.name,
        description: values.description ?? '',
        enabled: values.enabled,
        config: configFromEntries(values.configEntries, editing?.config ?? {}),
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<LibraryRecord> = [
    { title: tr('能力字段'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ToolOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('说明'), dataIndex: 'description', key: 'description', render: (value: string) => value || '—' },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: prettyDate },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveLibrary(kind, { ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteLibrary(kind, row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun={libraryNames[kind].toUpperCase()} action={`${tr('新增')} ${libraryNames[kind]}`} onCreate={() => drawer.edit()} />
    {data.length ? <Table<LibraryRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={`${tr('还没有')} ${libraryNames[kind]}`} description={`${tr('添加')} ${libraryNames[kind]}${tr('，再按群聊策略选择启用范围。')}`} onCreate={() => drawer.edit()} action={`${tr('新增')} ${libraryNames[kind]}`} />}
    <Drawer title={<DrawerTitle label={`${kind.toUpperCase()} / LIBRARY`} title={editing ? `${tr('编辑')} ${libraryNames[kind]}` : `${tr('新增')} ${libraryNames[kind]}`} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="description" label={tr('说明')}><Input.TextArea rows={3} /></Form.Item>
        <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('配置项')}</span><small>KEY / TYPE / VALUE</small></div>
          <Form.List name="configEntries">
            {(fields, { add, remove }) => <>
              {fields.map((field) => <ConfigEntryRow key={field.key} field={field} onRemove={() => remove(field.name)} />)}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ key: '', type: 'text', value: '' })}>{tr('添加配置项')}</Button>
            </>}
          </Form.List>
        </div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function LogsPage({ data, total, enabled, accounts, groups, page, onPage, form, onFilter }: {
  data: ConversationLog[]; total: number; enabled: boolean | null; accounts: BotAccountRecord[]; groups: GroupRecord[]; page: number; onPage: (value: number) => void; form: FormInstance<LogFilters>; onFilter: (values: LogFilters) => void;
}) {
  const { language, tr } = useI18n();
  const columns: TableColumnsType<ConversationLog> = [
    { title: tr('时间'), dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (value: number) => prettyDate(value) },
    { title: tr('方向'), dataIndex: 'direction', key: 'direction', width: 110, render: (value: string) => <Tag className={`direction-tag direction-${value}`} icon={value === 'in' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}>{value === 'in' ? tr('收到') : tr('发出')}</Tag> },
    { title: tr('群聊'), dataIndex: 'groupExternalId', key: 'groupExternalId', width: 180, render: (value: string, row) => groups.find((item) => item.id === row.groupId)?.name || value },
    { title: tr('用户 ID'), dataIndex: 'userId', key: 'userId', width: 180, render: (value: string) => <code className="table-code">{value}</code> },
    { title: tr('消息'), dataIndex: 'content', key: 'content', render: (value: string) => <span className="log-content">{value}</span> },
  ];
  if (enabled === false) return <section className="logs-disabled"><div className="disabled-icon"><MessageOutlined /></div><div className="eyebrow"><span className="eyebrow-line" /> OBSERVABILITY / DISABLED</div><Title level={2}>{tr('对话日志已关闭')}</Title><Paragraph>{tr('服务端未启用 LOG_RECORD。如需记录对话，请在部署环境启用该配置；现有日志保留策略为 30 天。')}</Paragraph><div className="disabled-meta"><span>LOG_RECORD</span><b>OFF</b><span>RETENTION</span><b>30 DAYS</b></div></section>;
  return <section className="data-page logs-page">
    <div className="log-toolbar"><Form form={form} layout="inline" onFinish={onFilter} className="log-filter-form">
      <Form.Item name="q"><Input allowClear prefix={<MessageOutlined />} placeholder={tr('搜索消息内容或用户 ID')} /></Form.Item>
      <Form.Item name="from"><Input type="datetime-local" aria-label={tr('开始时间')} /></Form.Item>
      <Form.Item name="to"><Input type="datetime-local" aria-label={tr('结束时间')} /></Form.Item>
      <Form.Item name="accountId"><Select allowClear placeholder={tr('全部账号')} options={accounts.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
      <Form.Item name="groupId"><Select allowClear placeholder={tr('全部群聊')} options={groups.map((item) => ({ label: item.name || item.externalId, value: item.id }))} /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit">{tr('应用筛选')}</Button></Form.Item>
      <Form.Item><Button onClick={() => { form.resetFields(); onFilter({}); }}>{tr('重置')}</Button></Form.Item>
    </Form><div className="log-count"><span className="online-dot" /> {total} RECORDS / 30D</div></div>
    {data.length ? <><Table<ConversationLog> rowKey="id" columns={columns} dataSource={data} pagination={false} scroll={{ x: 950 }} className="data-table logs-table" /><div className="logs-pagination"><span>{language === 'en' ? `Page ${page} of ${Math.max(1, Math.ceil(total / 20))}` : `第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / 20))} 页`}</span><Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={onPage} /></div></> : <EmptyTable title={tr('没有匹配的对话记录')} description={tr('尝试调整筛选条件，或确认服务端日志记录已启用。')} />}
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

export default function App() {
  return <LanguageProvider><ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#78cfc3', colorInfo: '#78cfc3', colorSuccess: '#78cfc3', colorBgBase: '#101619', colorBgContainer: '#171f22', colorBgElevated: '#202a2d', colorText: '#e6ecea', colorTextSecondary: '#a1b0ae', colorBorder: '#303d40', borderRadius: 3, fontFamily: '"IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif', controlHeight: 38 } }}><AntApp><RoutedApp /></AntApp></ConfigProvider></LanguageProvider>;
}
