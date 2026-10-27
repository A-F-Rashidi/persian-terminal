# Persian Terminal

**[English](#english) · [فارسی](#persian)**

<a id="english"></a>

Read Persian naturally in VS Code, with connected letters and right-to-left text alongside English commands.

## Features

- **Readable Persian output:** connected letters, RTL alignment and a bundled Vazirmatn font that works offline.
- **Real terminal sessions:** VS Code PTY/ConPTY handles interactive programs across languages.
- **Independent tabs:** keep separate working directories and shell environments.
- **Python file runner:** launch the open file using your selected interpreter. Running again while it is busy closes that session and starts fresh in the same tab.
- **Clear input history:** submitted answers have a small input label; the final output section is labeled after execution finishes.
- **Search, copy and export:** find text in the current tab and save an individual run's output.
- **Adjustable display:** font size, compact spacing, and Persian alignment.
- **Native terminal access:** open the underlying terminal for full-screen programs, hidden password input and special keys.

![Welcome screen](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/welcome.png)

## Quick start

1. Install the VSIX using **Extensions: Install from VSIX**, then run **Developer: Reload Window**.
2. Open **Persian Terminal: Open** from the Command Palette.
3. Choose an installed shell with Shell Integration: PowerShell 7 or Git Bash on Windows; Bash, Zsh or PowerShell 7 on Linux/macOS.
4. Keep **terminal.integrated.shellIntegration.enabled** enabled.
5. Open a Python file and choose **Run Python File in Persian Terminal**, or enter a command directly.

The extension does not install interpreters or compilers. Use your normal commands, such as **node app.js**, **go run .**, or **python app.py**.

## Interactive input and rerunning

![Interactive input](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/input.png)

Enter an answer in the bottom field and press Enter. During a running program, this sends input rather than launching another command.

To restart a Python file, use **Run Python File in Persian Terminal** again. The previous session is closed, its environment changes are discarded, and a fresh session starts in the same tab. Previous output remains visible.

Python runs from the workspace folder, or from its file folder when no workspace is open. Configure **persianTerminal.pythonPath** to override the interpreter; otherwise the Python extension's selected interpreter takes priority over the local .venv/system fallback.

## Display settings

![Display settings](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/settings.png)

Use **Display** to change font size, spacing and Persian alignment. Ctrl+F searches, Ctrl+L clears the view, Shift+Enter adds a line, and Ctrl+C interrupts a program when no text is selected.

## Troubleshooting and limits

- If shell integration is unavailable, the native terminal opens with a setup message. Windows PowerShell and PowerShell 7 are different shells.
- Use **Native terminal** for full-screen interfaces, passwords and arrow-key interaction.
- Output and stderr share one stream in PTY mode. Input/output labels describe event order; they do not infer the meaning of program text.
- Copy/export excludes decorative labels and separate submitted-input rows. History is bounded and kept in memory.
- Ctrl+C is a request to interrupt; some programs may ignore it. Closing the tab closes its terminal.
- Set **persianTerminal.sessionBackend** to **legacy** and open a new tab only if you need the older pipe-based behavior.

## Development

Run **npm ci**, **npm test**, and **npm run package** in the source folder. Automated tests include shell processes and mocked VS Code terminal APIs; they do not establish compatibility with every Windows/ConPTY program.

[Shell Integration documentation](https://code.visualstudio.com/docs/terminal/shell-integration)

---

<a id="persian"></a>

<div dir="rtl" align="right">


<h1 align="center">Persian Terminal · ترمینال فارسی</h1>
<p align="center"><strong>فارسی را همان‌طور که باید، بخوان.</strong></p>

اگر خروجی فارسی برنامه‌ات در ترمینال ناخوانا می‌شود، این افزونه یک پنل برای خواندن فارسی و انگلیسی کنار هم در VS Code در اختیارت می‌گذارد. دستورها در شل واقعی اجرا می‌شوند؛ متن فارسی با حروف متصل و چینش راست‌به‌چپ نمایش داده می‌شود.

## یک نگاه به محیط

![صفحه شروع ترمینال فارسی](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/welcome.png)

*تصاویر راهنما از نسخه ۰.۳.۲ هستند؛ نسخه این بسته ۰.۳.۵ است.*

## نصب و اولین اجرا

۱. فایل VSIX را از بسته استخراج کن.
۲. در VS Code کلیدهای **Ctrl+Shift+P** را بزن و **Extensions: Install from VSIX** را انتخاب کن.
۳. فایل افزونه را انتخاب و سپس **Developer: Reload Window** را اجرا کن.
۴. از پنجره فرمان‌ها، **Persian Terminal: Open** را باز کن.
۵. از گزینه شل در نوار بالا، یک شل نصب‌شده و سازگار انتخاب کن.

برای امتحان، این دستور را وارد کن:

</div>
<pre dir="ltr">python -c "print('سلام دنیا؛ آماده‌ای؟')"</pre>
<div dir="rtl" align="right">

اگر فرمان پایتون روی سیستم تو <code>python3</code> است، همان را جایگزین کن. افزونه مفسر یا کامپایلر زبان‌ها را نصب نمی‌کند.

### انتخاب شل

حالت پیش‌فرض از PTY خود VS Code و ConPTY در ویندوز استفاده می‌کند. برای اتصال خروجی به پنل فارسی، **Shell Integration** باید فعال باشد.

- **ویندوز:** PowerShell 7 با نام <code>pwsh</code> یا Git Bash.
- **لینوکس و مک:** Bash، Zsh یا PowerShell 7.
- در تنظیمات VS Code، گزینه <code>terminal.integrated.shellIntegration.enabled</code> را فعال نگه دار.

PowerShell قدیمی ویندوز با PowerShell 7 یکسان نیست. اگر اتصال شل آماده نشود، پیام راهنما نمایش داده می‌شود و ترمینال اصلی باز می‌شود؛ دستور بی‌صدا در حالت دیگری اجرا نمی‌شود.

## اجرای فایل پایتون

فایل را باز کن و از منوی اجرای ادیتور یا کلیک راست، **Run Python File in Persian Terminal** را انتخاب کن.

اولویت مفسر: مسیر پایتون در تنظیمات افزونه، مفسر انتخاب‌شده در افزونه رسمی Python، و در نبود افزونه Python، محیط <code>.venv</code> پروژه یا فرمان پایتون سیستم. اگر افزونه Python نصب باشد ولی مفسر انتخاب نشده باشد، باید آن را انتخاب کنی.

اجرا از پوشه پروژه انجام می‌شود. اگر پروژه‌ای باز نباشد، پوشه خود فایل مبنای اجراست. مسیر پوشه و نام فایل در بالای پنل دیده می‌شوند.

### اجرای دوباره هنگام دریافت ورودی

اگر برنامه هنوز اجرا می‌شود یا منتظر پاسخ است، دوباره **Run Python File in Persian Terminal** را بزن. اجرای قبلی متوقف و نشست آن بسته می‌شود؛ فایل در یک نشست تازه، در همان تب، از ابتدا اجرا می‌شود.

خروجی قبلی برای مقایسه باقی می‌ماند. متغیرها و تغییرات محیطی نشست قبلی به نشست تازه منتقل نمی‌شوند. لغو ذخیره فایل، برنامه در حال اجرا را متوقف نمی‌کند. کادر «ارسال» پایین پنل همچنان برای پاسخ‌دادن به برنامه است، نه اجرای مجدد فایل.

## پاسخ‌دادن به برنامه

![دریافت ورودی از کاربر](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/input.png)

پاسخ را در کادر پایین بنویس و **ارسال** یا **Enter** را بزن. پاسخ ارسالی با برچسب کوچک «ورودی» ثبت می‌شود.

سوال‌ها برچسب خروجی ندارند. پس از پایان اجرا، بخش بعد از آخرین پاسخ با برچسب «خروجی» مشخص می‌شود. این دسته‌بندی بر اساس ترتیب رویدادهاست؛ افزونه معنای سوال و جواب را تشخیص نمی‌دهد.

برای زبان‌های دیگر، فرمان معمول آن‌ها را وارد کن؛ مثل <code>node app.js</code> یا <code>go run .</code>. دریافت ورودی در حالت ترمینال واقعی به پایتون محدود نیست.

## ظاهر دلخواه

![تنظیم اندازه متن و چینش فارسی](https://raw.githubusercontent.com/A-F-Rashidi/persian-terminal/main/media/screenshots/settings.png)

از **نمایش**، اندازه متن، فاصله‌ها و چینش فارسی را تغییر بده. فونت وزیرمتن همراه افزونه است و برای نمایش آن به اینترنت نیاز نداری.

## ابزارهای روزمره

| ابزار | کاربرد |
| --- | --- |
| ＋ | تب تازه با نشست مستقل |
| دوبار کلیک روی نام تب | تغییر نام تب |
| پوشه | تغییر پوشه اجرای دستورها |
| جست‌وجو | پیدا کردن متن در خروجی تب |
| کپی / ذخیره کنار اجرا | برداشتن خروجی همان اجرا |
| پاک‌کردن | پاک‌کردن نمایش؛ بدون بستن نشست |
| توقف | ارسال Ctrl+C در حالت ترمینال واقعی |
| ترمینال اصلی | بازکردن نمای بومی همان ترمینال |

کپی و ذخیره خروجی شامل برچسب‌های نمایشی و ردیف جداگانه ورودی کاربر نیست. تاریخچه داخل حافظه و محدود است؛ برای نگه‌داشتن نتیجه مهم، آن را ذخیره کن.

**میانبرها:** Enter برای اجرا یا ارسال، Shift+Enter برای خط بعد، ↑ و ↓ برای تاریخچه، Ctrl+F برای جست‌وجو و Ctrl+L برای پاک‌کردن خروجی. Ctrl+C وقتی متنی انتخاب نشده باشد، توقف می‌فرستد.

## اگر چیزی درست کار نکرد

- **شل پیدا نمی‌شود:** از فهرست شل‌ها انتخاب کن یا مسیر صحیح را در <code>persianTerminal.shellPath</code> وارد کن.
- **مفسر پایتون اشتباه است:** **Python: Select Interpreter** را اجرا کن؛ یا <code>persianTerminal.pythonPath</code> را تغییر بده.
- **برنامه تمام‌صفحه، رمز مخفی یا کلیدهای جهت دارد:** از **ترمینال اصلی** استفاده کن. پنل فارسی برای خروجی متنی طراحی شده است.
- **برنامه با توقف بسته نمی‌شود:** ممکن است Ctrl+C را نادیده بگیرد. بستن تب یا اجرای دوباره فایل پایتون، نشست را می‌بندد.
- **به رفتار نسخه قدیمی نیاز داری:** <code>persianTerminal.sessionBackend</code> را به <code>legacy</code> تغییر بده و یک تب تازه باز کن. این حالت محدودیت‌های ورودی شل نسخه‌های قبلی را دارد.

## توسعه و محدودیت بررسی

سورس TypeScript همراه بسته است. در پوشه سورس، به ترتیب <code>npm ci</code>، <code>npm test</code> و <code>npm run package</code> را اجرا کن. فایل نصب با ابزار رسمی vsce ساخته می‌شود. تصاویر راهنما از مخزن عمومی گیت‌هاب بارگذاری می‌شوند.

آزمون‌ها شامل منطق نشست، ورودی فارسی، نمایش متن و شبیه‌سازی رابط ترمینال VS Code هستند. شبیه‌سازی جای آزمایش واقعی روی ویندوز را نمی‌گیرد؛ رفتار کامل ConPTY و همه برنامه‌های تعاملی در این محیط تایید نشده است.

[راهنمای Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)

</div>
