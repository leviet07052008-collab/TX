#!/usr/bin/env python3
# txauto - Tool tự động lấy phiên, kết quả Tài Xỉu và dự đoán
# Dành cho mục đích nghiên cứu lập trình

import requests
import json
import time
import random
import os
import sys
from datetime import datetime

URL = "https://web.sunwin.today"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
FILE_DATA = "data.json"
history = []

def get_session():
    try:
        r = requests.get(f"{URL}/api/session", headers=HEADERS, timeout=5)
        return r.json().get("session_id", str(int(time.time()*1000))) if r.status_code == 200 else str(int(time.time()*1000))
    except:
        return str(int(time.time()*1000))

def get_result(sid):
    try:
        r = requests.get(f"{URL}/api/result/{sid}", headers=HEADERS, timeout=5)
        if r.status_code == 200:
            d = r.json()
            dice = d.get("dice", [1,2,3])
            total = sum(dice)
            return {"session": sid, "dice": dice, "total": total, "result": "TÀI" if total >= 11 else "XỈU", "time": datetime.now().isoformat()}
    except:
        return None

def predict(hist, method="trend"):
    if len(hist) < 3:
        return random.choice(["TÀI", "XỈU"])
    if method == "trend":
        s = "".join([h["result"][0] for h in hist[-10:]])
        if s.count("T") > s.count("X") + 1:
            return "XỈU"
        elif s.count("X") > s.count("T") + 1:
            return "TÀI"
        return "XỈU" if hist[-1]["total"] >= 11 else "TÀI"
    elif method == "fib":
        avg = sum([h["total"] for h in hist[-5:]]) / 5
        return "TÀI" if avg >= 10.5 else "XỈU"
    else:
        return "TÀI" if random.random() > 0.45 else "XỈU"

def load_data():
    global history
    if os.path.exists(FILE_DATA):
        try:
            with open(FILE_DATA, "r", encoding="utf-8") as f:
                history = json.load(f)
        except:
            history = []

def save_data():
    with open(FILE_DATA, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def main(interval=8, method="trend"):
    load_data()
    print(f"[{datetime.now()}] TXAuto started - method: {method}")
    last_sid = ""
    while True:
        try:
            sid = get_session()
            if sid == last_sid:
                time.sleep(2)
                continue
            last_sid = sid
            data = get_result(sid)
            if data:
                history.append(data)
                if len(history) > 100:
                    history = history[-100:]
                save_data()
                pred = predict(history, method)
                print(f"[{data['time'][:19]}] SID: {sid} | Dice: {data['dice']} | Total: {data['total']} | Result: {data['result']} | Predict: {pred} {'✅' if pred == data['result'] else '❌'}")
            else:
                print(f"[{datetime.now()}] No data for {sid}, waiting...")
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\nStopped. Data saved.")
            save_data()
            sys.exit(0)
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(interval)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--help":
            print("Usage: python3 txauto.py [interval] [method]")
            print("  interval: seconds (default 8)")
            print("  method: trend, fib, random (default trend)")
            sys.exit(0)
    iv = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    mt = sys.argv[2] if len(sys.argv) > 2 else "trend"
    main(iv, mt)