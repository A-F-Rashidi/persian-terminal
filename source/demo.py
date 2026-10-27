"""Run with python demo.py; add --interactive for a line-based stdin example."""
import sys
import time

print("سلام دنیا؛ خروجی فارسی باید متصل و خوانا باشد.")
print("فایل report.py با Python 3.12 اجرا شد؛ نتیجه: ۱۲۳۴۵")
print("\033[32mموفق: اتصال برقرار شد.\033[0m")
print("\033[33mهشدار: این فقط یک نمونه است.\033[0m")
print("یک پیام فارسی در stderr", file=sys.stderr)
print('<script>alert("این متن نباید اجرا شود")</script>')
for progress in range(0, 101, 10):
    print(f"\rDownload: {progress:3d}%", end="", flush=True)
    time.sleep(0.1)
print("\rDownload complete.\033[K")
if "--interactive" in sys.argv:
    name = input("نامت را بنویس و Enter بزن: ")
    print(f"خوش آمدی، {name}!")
