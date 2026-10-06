"""
中文标签表：Whisper 语种代码 → 中文语言名；AudioSet 常见类别 → 中文名 + 分组。
未收录的类别会显示英文原名（分组按关键词推断）。可直接在这里补充。
"""
from __future__ import annotations

LANG_NAMES = {
    "zh": "中文", "yue": "粤语", "en": "英语", "ja": "日语", "ko": "韩语", "fr": "法语", "de": "德语",
    "es": "西班牙语", "pt": "葡萄牙语", "it": "意大利语", "ru": "俄语", "ar": "阿拉伯语", "hi": "印地语",
    "th": "泰语", "vi": "越南语", "id": "印尼语", "ms": "马来语", "tr": "土耳其语", "nl": "荷兰语",
    "pl": "波兰语", "uk": "乌克兰语", "sv": "瑞典语", "no": "挪威语", "da": "丹麦语", "fi": "芬兰语",
    "el": "希腊语", "he": "希伯来语", "fa": "波斯语", "ur": "乌尔都语", "bn": "孟加拉语", "ta": "泰米尔语",
    "te": "泰卢固语", "tl": "菲律宾语", "cs": "捷克语", "ro": "罗马尼亚语", "hu": "匈牙利语",
    "ca": "加泰罗尼亚语", "sw": "斯瓦希里语", "mn": "蒙古语", "bo": "藏语", "ug": "维吾尔语",
    "km": "高棉语", "lo": "老挝语", "my": "缅甸语", "ne": "尼泊尔语", "la": "拉丁语",
}


def lang_name(code: str | None) -> str:
    return LANG_NAMES.get(code or "", code or "未知")


# 分组：human 人类 / bird 鸟类 / animal 动物 / insect 昆虫 / plant 植物·风声 / nature 水·天气
#       music 音乐 / vehicle 交通机械 / other 其它
# 说明：植物本身不发声，“植物·风声”指树叶沙沙、风吹过植被等声音。
AUDIOSET_ZH: dict[str, tuple[str, str]] = {
    # 人声
    "Speech": ("语音", "human"), "Male speech, man speaking": ("男声说话", "human"),
    "Female speech, woman speaking": ("女声说话", "human"), "Child speech, kid speaking": ("儿童说话", "human"),
    "Conversation": ("对话", "human"), "Narration, monologue": ("旁白", "human"), "Babbling": ("咿呀声", "human"),
    "Whispering": ("耳语", "human"), "Laughter": ("笑声", "human"), "Crying, sobbing": ("哭声", "human"),
    "Baby cry, infant cry": ("婴儿哭", "human"), "Shout": ("喊叫", "human"), "Yell": ("大喊", "human"),
    "Screaming": ("尖叫", "human"), "Singing": ("唱歌", "human"), "Choir": ("合唱", "human"),
    "Humming": ("哼唱", "human"), "Whistling": ("口哨", "human"), "Breathing": ("呼吸", "human"),
    "Cough": ("咳嗽", "human"), "Sneeze": ("喷嚏", "human"), "Footsteps": ("脚步声", "human"),
    "Clapping": ("鼓掌", "human"), "Applause": ("掌声", "human"), "Crowd": ("人群", "human"),
    "Chatter": ("嘈杂人声", "human"),
    # 动物
    "Animal": ("动物", "animal"), "Domestic animals, pets": ("家养动物", "animal"),
    "Dog": ("狗", "animal"), "Bark": ("狗叫", "animal"), "Howl": ("嚎叫", "animal"), "Growling": ("低吼", "animal"),
    "Cat": ("猫", "animal"), "Meow": ("猫叫", "animal"), "Purr": ("呼噜声", "animal"),
    "Livestock, farm animals, working animals": ("家畜", "animal"), "Horse": ("马", "animal"),
    "Cattle, bovinae": ("牛", "animal"), "Moo": ("牛叫", "animal"), "Pig": ("猪", "animal"),
    "Sheep": ("羊", "animal"), "Goat": ("山羊", "animal"), "Chicken, rooster": ("鸡", "bird"),
    "Crowing, cock-a-doodle-doo": ("公鸡打鸣", "bird"), "Duck": ("鸭", "bird"), "Quack": ("鸭叫", "bird"),
    "Goose": ("鹅", "bird"), "Wild animals": ("野生动物", "animal"),
    "Bird": ("鸟", "bird"), "Bird vocalization, bird call, bird song": ("鸟鸣", "bird"),
    "Chirp, tweet": ("啾啾声", "bird"), "Squawk": ("鸟尖叫", "bird"),
    "Pigeon, dove": ("鸽子", "bird"), "Coo": ("咕咕声", "bird"), "Crow": ("乌鸦", "bird"), "Caw": ("鸦叫", "bird"),
    "Owl": ("猫头鹰", "bird"), "Hoot": ("鸮鸣", "bird"), "Gull, seagull": ("海鸥", "bird"),
    "Bird flight, flapping wings": ("振翅", "bird"),
    "Insect": ("昆虫", "insect"), "Cricket": ("蟋蟀", "insect"), "Mosquito": ("蚊子", "insect"),
    "Fly, housefly": ("苍蝇", "insect"), "Bee, wasp, etc.": ("蜜蜂 / 黄蜂", "insect"), "Buzz": ("嗡嗡声", "insect"),
    "Frog": ("青蛙", "animal"), "Croak": ("蛙鸣", "animal"), "Snake": ("蛇", "animal"),
    "Rodents, rats, mice": ("鼠类", "animal"), "Whale vocalization": ("鲸鸣", "animal"),
    "Roaring cats (lions, tigers)": ("大型猫科吼叫", "animal"), "Roar": ("吼叫", "animal"),
    # 自然
    "Wind": ("风", "plant"), "Rustling leaves": ("树叶沙沙", "plant"), "Wind noise (microphone)": ("麦克风风噪", "plant"),
    "Thunderstorm": ("雷雨", "nature"), "Thunder": ("雷声", "nature"), "Rain": ("雨", "nature"),
    "Raindrop": ("雨滴", "nature"), "Rain on surface": ("雨打表面", "nature"), "Water": ("水", "nature"),
    "Stream": ("溪流", "nature"), "Waterfall": ("瀑布", "nature"), "Ocean": ("海洋", "nature"),
    "Waves, surf": ("海浪", "nature"), "Fire": ("火", "nature"), "Crackle": ("噼啪声", "nature"),
    "Natural sounds": ("自然声", "nature"), "Wood": ("木头声", "plant"), "Crunch": ("咔嚓声", "plant"),
    "Cicada": ("蝉鸣", "insect"), "Bird song": ("鸟鸣", "bird"), "Songbird": ("鸣禽", "bird"), "Outside, rural or natural": ("户外 · 自然环境", "nature"),
    "Outside, urban or manmade": ("户外 · 城市环境", "other"), "Inside, small room": ("室内 · 小房间", "other"),
    "Silence": ("安静", "other"),
    # 音乐
    "Music": ("音乐", "music"), "Musical instrument": ("乐器", "music"), "Guitar": ("吉他", "music"),
    "Piano": ("钢琴", "music"), "Violin, fiddle": ("小提琴", "music"), "Drum": ("鼓", "music"),
    "Drum kit": ("架子鼓", "music"), "Bass drum": ("底鼓", "music"), "Cymbal": ("镲", "music"),
    "Hi-hat": ("踩镲", "music"), "Flute": ("长笛", "music"), "Synthesizer": ("合成器", "music"),
    "Electronic music": ("电子音乐", "music"), "Orchestra": ("管弦乐", "music"), "Bell": ("铃", "music"),
    "Sine wave": ("正弦波", "music"), "Beep, bleep": ("哔声", "other"), "Tone": ("纯音", "music"),
    "Chirp tone": ("扫频音", "music"),
    # 交通 / 机械
    "Vehicle": ("车辆", "vehicle"), "Car": ("汽车", "vehicle"), "Motorcycle": ("摩托车", "vehicle"),
    "Truck": ("卡车", "vehicle"), "Bus": ("公交车", "vehicle"), "Train": ("火车", "vehicle"),
    "Aircraft": ("飞机", "vehicle"), "Helicopter": ("直升机", "vehicle"), "Siren": ("警笛", "vehicle"),
    "Vehicle horn, car horn, honking": ("汽车喇叭", "vehicle"), "Traffic noise, roadway noise": ("交通噪声", "vehicle"),
    "Engine": ("发动机", "vehicle"), "Mechanisms": ("机械", "vehicle"), "Tools": ("工具", "vehicle"),
    "Door": ("门", "other"), "Knock": ("敲击", "other"), "Typing": ("打字", "other"),
    "Telephone": ("电话", "other"), "Alarm": ("警报", "other"), "Clock": ("钟表", "other"),
    "Noise": ("噪声", "other"), "White noise": ("白噪声", "other"), "Static": ("静电噪声", "other"),
}

_GROUP_KEYWORDS = [
    ("bird", ["bird", "owl", "crow", "duck", "goose", "chicken", "rooster", "gull", "pigeon", "dove", "chirp", "tweet", "squawk", "caw", "hoot", "coo"]),
    ("insect", ["insect", "bee", "wasp", "cricket", "mosquito", "fly", "cicada", "buzz"]),
    ("animal", ["dog", "cat", "frog", "animal", "horse", "cattle", "pig", "sheep", "goat", "whale", "rodent", "bark",
                "meow", "howl", "roar", "moo", "neigh", "oink", "bleat", "growl", "purr", "snake", "croak"]),
    ("plant", ["leaves", "rustl", "wind", "wood", "branch"]),
    ("nature", ["rain", "water", "thunder", "stream", "ocean", "wave", "fire", "natural", "storm", "waterfall"]),
    ("human", ["speech", "speak", "voice", "laugh", "cry", "sing", "whistl", "breath", "cough", "clap", "crowd"]),
    ("music", ["music", "guitar", "piano", "drum", "violin", "flute", "synth", "orchestra", "instrument", "bell"]),
    ("vehicle", ["vehicle", "car", "engine", "train", "aircraft", "truck", "motor", "siren", "traffic"]),
]


def audioset_label(en: str) -> tuple[str, str]:
    """返回 (中文名或英文原名, 分组)。"""
    if en in AUDIOSET_ZH:
        return AUDIOSET_ZH[en]
    low = en.lower()
    for group, kws in _GROUP_KEYWORDS:
        if any(k in low for k in kws):
            return en, group
    return en, "other"


GROUP_ORDER = ["human", "bird", "animal", "insect", "plant", "nature", "music", "vehicle", "other"]

# 用于判断“是不是鸟叫 / 是不是说话”的类别
BIRD_LABELS = {"Bird", "Bird vocalization, bird call, bird song", "Chirp, tweet", "Squawk",
               "Pigeon, dove", "Coo", "Crow", "Caw", "Owl", "Hoot", "Gull, seagull"}
SPEECH_LABELS = {"Speech", "Male speech, man speaking", "Female speech, woman speaking",
                 "Child speech, kid speaking", "Conversation", "Narration, monologue", "Whispering"}
