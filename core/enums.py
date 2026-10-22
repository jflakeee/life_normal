from enum import Enum, IntEnum


class Line(Enum):
    """계열"""

    TRANSPORT = "운송"
    HUNTING = "사냥"
    CONSTRUCTION = "건축"
    MEDICAL = "치료"
    SECURITY = "보안"
    COLLECTING = "수집"


class Tier(IntEnum):
    HOBBY = 1
    JOB = 2
    BUSINESS = 3


class Rank(IntEnum):
    APPRENTICE = 1  # 견습
    REGULAR = 2  # 정규
    EXPERT = 3  # 전문
    CHIEF = 4  # 책임


class MissionType(Enum):
    ROUTINE = "상시"
    REQUEST = "의뢰"
    EMERGENCY = "돌발"


class ItemKind(Enum):
    RAW = "원자재"
    PROCESSED = "가공품"
    COLLECTIBLE = "컬렉션"


class Rarity(Enum):
    COMMON = "일반"
    RARE = "희귀"
    LEGENDARY = "전설"
