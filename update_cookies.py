import browser_cookie3 as bc
import http.cookiejar as cookielib
import os

try:
    # Sao lưu file cookies hiện tại nếu có
    if os.path.exists('cookies.txt'):
        os.rename('cookies.txt', 'cookies.txt.bak')
        print("Đã sao lưu cookies.txt cũ sang cookies.txt.bak")

    # Lấy cookie từ Chrome và lưu vào file
    cookies = bc.chrome(domain_name='youtube.com')

    # Tạo cookiejar mới
    cookiejar = cookielib.MozillaCookieJar('cookies.txt')

    # Thêm cookie từ trình duyệt vào cookiejar
    for cookie in cookies:
        cookiejar.set_cookie(cookie)

    # Lưu cookiejar vào file
    cookiejar.save()
    print('Đã tạo cookies.txt mới thành công')
except Exception as e:
    print(f"Lỗi: {e}")
    # Khôi phục file cookies cũ nếu có lỗi và đã sao lưu
    if os.path.exists('cookies.txt.bak') and not os.path.exists('cookies.txt'):
        os.rename('cookies.txt.bak', 'cookies.txt')
        print("Đã khôi phục cookies.txt từ bản sao lưu")
