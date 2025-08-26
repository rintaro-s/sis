from flask import Flask, request
import datetime

app = Flask(__name__)

@app.route('/log', methods=['POST'])
def receive_log():
    # リクエストボディからログデータを受け取る
    log_data = request.get_data(as_text=True)

    # 現在時刻を取得
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 受け取ったログをコンソールに表示
    print(f"[{timestamp}] Received log:")
    print(log_data)
    print("---")

    # クライアントに成功を返す
    return "Log received successfully", 200

if __name__ == '__main__':
    # サーバーを起動
    # ホスト '0.0.0.0' は、外部からのアクセスを許可する設定
    app.run(host='0.0.0.0', port=808, debug=True)