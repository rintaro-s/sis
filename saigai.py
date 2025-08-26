#!/usr/bin/env python3
import requests
import xmltodict
import time
from datetime import datetime

# --- 設定するところ ---

# お兄ちゃんの街を設定してね (部分一致でチェックするよ)
MY_CITY = "伊勢"
# この震度「以上」でお知らせするよ (4.0で「4」以上)
EARTHQUAKE_THRESHOLD = 4.0
# 何秒ごとに情報をチェックするか
CHECK_INTERVAL_SECONDS = 60 # 速報性を重視して少し短くしたよ

# --- ここから下はプログラムだよ ---

processed_entry_ids = set()
# 気象庁の利用規約に従って、連絡先を記載してね
HEADERS = {
    'User-Agent': 'SIST_UI_Disaster_Check/1.2 (Contact: your-email@example.com)'
}
INTENSITY_MAP = {
    "1": 1.0, "2": 2.0, "3": 3.0, "4": 4.0,
    "5-": 5.0, "5弱": 5.0,
    "5+": 5.5, "5強": 5.5,
    "6-": 6.0, "6弱": 6.0,
    "6+": 6.5, "6強": 6.5,
    "7": 7.0,
    # 緊急地震速報用の震度
    "最大震度１": 1.0, "最大震度２": 2.0, "最大震度３": 3.0, "最大震度４": 4.0,
    "最大震度５弱": 5.0, "最大震度５強": 5.5, "最大震度６弱": 6.0,
    "最大震度６強": 6.5, "最大震度７": 7.0
}

def convert_intensity_to_number(intensity_str):
    if not intensity_str: return 0.0
    return INTENSITY_MAP.get(intensity_str, 0.0)

def get_feed_entries(feed_url):
    try:
        response = requests.get(feed_url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        feed_data = xmltodict.parse(response.content)
        entries = feed_data.get('feed', {}).get('entry', [])
        return [entries] if not isinstance(entries, list) else entries
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M')}] フィード取得/解析エラー ({feed_url}): {e}")
    return []

def check_standard_earthquake():
    """震源・震度情報をチェックするよ"""
    feed_url = "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml"
    entries = get_feed_entries(feed_url)
    result = {'found': False, 'message': ''}

    for entry in entries:
        entry_id = entry.get('id')
        if not entry_id or entry_id in processed_entry_ids: continue
        if '震源・震度に関する情報' not in entry.get('title', ''): continue

        detail_url = entry.get('link', {}).get('@href')
        if not detail_url: continue
        
        try:
            detail_response = requests.get(detail_url, headers=HEADERS, timeout=10)
            detail_data = xmltodict.parse(detail_response.content)
            report = detail_data.get('Report', {})
            headline = report.get('Head', {}).get('Headline', {}).get('Text', '詳細不明')
            prefs = report.get('Body', {}).get('Intensity', {}).get('Observation', {}).get('Pref', [])
            if not isinstance(prefs, list): prefs = [prefs]

            for pref in prefs:
                areas = pref.get('Area', [])
                if not isinstance(areas, list): areas = [areas]
                for area in areas:
                    city_name = area.get('Name')
                    max_int_str = area.get('MaxInt')
                    intensity_value = convert_intensity_to_number(max_int_str)
                    if city_name and MY_CITY in city_name and intensity_value >= EARTHQUAKE_THRESHOLD:
                        processed_entry_ids.add(entry_id)
                        message = f"【地震速報】\n{city_name}で震度{max_int_str}の地震を観測。\n気象庁発表：『{headline}』"
                        result['found'] = True
                        result['message'] = message
                        return result # 一件見つけたら即時返す
        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M')}] 地震詳細の解析エラー: {e}")
            
    return result

def check_emergency_earthquake_warning():
    """緊急地震速報（警報・予報）をチェックするよ"""
    feed_url = "https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml"
    entries = get_feed_entries(feed_url)
    result = {'found': False, 'message': ''}

    for entry in entries:
        entry_id = entry.get('id')
        if not entry_id or entry_id in processed_entry_ids: continue
        if '緊急地震速報' not in entry.get('title', ''): continue

        detail_url = entry.get('link', {}).get('@href')
        if not detail_url: continue

        try:
            detail_response = requests.get(detail_url, headers=HEADERS, timeout=10)
            detail_data = xmltodict.parse(detail_response.content)
            report = detail_data.get('Report', {})
            headline = report.get('Head', {}).get('Headline', {}).get('Text', '詳細不明')
            
            # EEW(警報)の強い揺れが予測される地域をチェック
            items = report.get('Body', {}).get('Intensity', {}).get('Forecast', {}).get('Item', [])
            if not isinstance(items, list): items = [items]
            
            for item in items:
                area_name = item.get('Area', {}).get('Name')
                forecast_int_from_str = item.get('ForecastInt', {}).get('From', '0')
                intensity_value = convert_intensity_to_number(forecast_int_from_str)
                if area_name and MY_CITY in area_name and intensity_value >= EARTHQUAKE_THRESHOLD:
                    processed_entry_ids.add(entry_id)
                    kind_name = item.get('Kind', {}).get('Name', '強い揺れ')
                    message = f"【緊急地震速報(EEW)】\n{area_name}に{kind_name}が発表されました！\n強い揺れに警戒してください！\n『{headline}』"
                    result['found'] = True
                    result['message'] = message
                    return result

        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M')}] EEW詳細の解析エラー: {e}")
            
    return result


def check_evacuation_warnings():
    """避難情報をチェックするよ"""
    feed_url = "https://www.data.jma.go.jp/developer/xml/feed/extra.xml"
    entries = get_feed_entries(feed_url)
    result = {'found': False, 'message': ''}

    for entry in entries:
        entry_id = entry.get('id')
        if not entry_id or entry_id in processed_entry_ids: continue
        if '避難情報' not in entry.get('title', ''): continue
        
        detail_url = entry.get('link', {}).get('@href')
        if not detail_url: continue
        
        try:
            detail_response = requests.get(detail_url, headers=HEADERS, timeout=10)
            detail_data = xmltodict.parse(detail_response.content)
            report = detail_data.get('Report', {})
            headline = report.get('Head', {}).get('Headline', {}).get('Text', '詳細不明')
            
            all_items = []
            warnings = report.get('Body', {}).get('Warning', [])
            if not isinstance(warnings, list): warnings = [warnings]
            for warn in warnings:
                items = warn.get('Item', [])
                if isinstance(items, list): all_items.extend(items)
                else: all_items.append(items)

            for item in all_items:
                if not isinstance(item, dict): continue
                if item.get('Kind', {}).get('Name') == '避難指示':
                    areas = item.get('Area', [])
                    if not isinstance(areas, list): areas = [areas]
                    for area in areas:
                        area_name = area.get('Name')
                        if area_name and MY_CITY in area_name:
                            processed_entry_ids.add(entry_id)
                            message = f"【避難指示】\n{area_name}に避難指示が発表されました。\n詳細：『{headline}』\n直ちに安全な場所へ避難してください！"
                            result['found'] = True
                            result['message'] = message
                            return result
        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M')}] 避難情報詳細の解析エラー: {e}")
            
    return result


def main():
    print(f"--- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {MY_CITY}の防災情報をチェックします ---")

    # 優先度1: 緊急地震速報
    eew_result = check_emergency_earthquake_warning()
    if eew_result['found']:
        print(eew_result['message'])
        return

    # 優先度2: 避難指示
    evac_result = check_evacuation_warnings()
    if evac_result['found']:
        print(evac_result['message'])
        return

    # 優先度3: 観測された地震情報
    eq_result = check_standard_earthquake()
    if eq_result['found']:
        print(eq_result['message'])
        return
    
    print("現在、特に緊急のお知らせはありません。")


if __name__ == "__main__":
    while True:
        main()
        print(f"次回のチェックは {CHECK_INTERVAL_SECONDS}秒後...")
        print("-" * 50)
        time.sleep(CHECK_INTERVAL_SECONDS)