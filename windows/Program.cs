using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Taskflow;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Taskflow");
        Directory.CreateDirectory(userDataFolder);

        // HTML 内嵌在 exe 中，每次启动释放到用户数据目录：单文件分发、无附属文件夹
        var appDir = Path.Combine(userDataFolder, "app");
        Directory.CreateDirectory(appDir);
        var htmlPath = Path.Combine(appDir, "taskflow.html");
        try
        {
            using var res = typeof(Program).Assembly.GetManifestResourceStream("Taskflow.taskflow.html")
                ?? throw new InvalidOperationException("内嵌的 taskflow.html 资源缺失");
            using var file = File.Create(htmlPath);
            res.CopyTo(file);
        }
        catch (Exception ex)
        {
            MessageBox.Show("无法释放应用资源：" + ex.Message, "Taskflow",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        using var form = new Form
        {
            Text = "Taskflow",
            Icon = LoadIcon(),
            MinimumSize = new Size(480, 640),
            StartPosition = FormStartPosition.CenterScreen,
            WindowState = FormWindowState.Maximized,
            BackColor = Color.FromArgb(246, 246, 249),
        };

        var webView = new WebView2 { Dock = DockStyle.Fill };
        form.Controls.Add(webView);

        // WebView2 初始化必须走消息循环异步续接，同步阻塞 UI 线程会死锁
        form.Load += async (s, e) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "需要 Microsoft Edge Web 视图组件（WebView2 Runtime）才能运行。\n" +
                    "请安装 Microsoft Edge 或 WebView2 Runtime 后重试。\n\n" + ex.Message,
                    "Taskflow", MessageBoxButtons.OK, MessageBoxIcon.Error);
                form.Close();
                return;
            }

            var core = webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping(
                "taskflow.app", appDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Navigate("https://taskflow.app/taskflow.html");
        };

        Application.Run(form);
    }

    private static Icon LoadIcon()
    {
        try
        {
            var asm = typeof(Program).Assembly;
            using var st = asm.GetManifestResourceStream("Taskflow.taskflow.ico");
            if (st != null) return new Icon(st);
        }
        catch
        {
            // 资源异常时退回系统默认图标，不影响启动
        }
        return SystemIcons.Application;
    }
}
