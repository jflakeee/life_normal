"""일상 임무 게임 - CLI 프로토타입 (설계안 v3).

실행: python -m tools.play        도움말: help
임무 1건 = 1틱(현실 3분 가정), 8틱 = 1게임일.
"""

from __future__ import annotations

import random
import sys

from core import collection
from core.config import BALANCE
from core.enums import Line, MissionType, Tier
from core.missions import TEMPLATES, MissionBoard, World, default_market
from core.model import (
    BUSINESS_OPEN_COST,
    BUSINESS_REVENUE,
    BUSINESS_TAX,
    DEATH_MONEY_LOSS,
    HOBBY_MEDICAL_DISCOUNT,
    MISSION_HOURS,
    MISSIONS_PER_DAY,
    SALES_TAX,
    Equipment,
    Player,
)

TICK_H = MISSION_HOURS
TICKS_PER_DAY = MISSIONS_PER_DAY
RISKY = {Line.HUNTING, Line.SECURITY}
INJURY_P, DEATH_P = BALANCE["economy"]["injury_p"], BALANCE["economy"]["death_p"]
SHOP = list(BALANCE["shop"].items())
LINE_BY_NAME = {l.value: l for l in Line}
DEFAULT_SAVE = "save.json"

HELP = """명령어
  s              상태 보기
  m              할 수 있는 임무 목록
  <번호>         임무 수행 (m 목록 번호)
  wait           한 틱 쉬기
  shop / buy <번호>   장비 상점 / 구매
  job <계열>     직업 취득 (예: job 사냥)
  up <계열>      직급 승급
  biz <계열>     사업 개설
  dex            수집 도감
  log            최근 사건
  save [파일]    저장 (기본 save.json)
  load [파일]    불러오기
  q              저장 후 종료"""


class Game:
    def __init__(self, seed: int | None = None, out=print):
        self.rng = random.Random(seed)
        self.world = World(default_market(), players=10)
        self.board = MissionBoard(self.world, self.rng)
        self.p = Player("you", money=100)
        self.out = out
        self.menu: list = []
        self.menu_tick = -1
        self.worked_today = False
        self.log_seen = 0
        self.tax_carry = 0.0  # 1 G 미만 판매세 누적

    # ── 표시 ─────────────────────────────────────────
    def status(self):
        p, w = self.p, self.world
        day, t = divmod(w.tick, TICKS_PER_DAY)
        self.out(f"[{day + 1}일차 {t + 1}/{TICKS_PER_DAY}] 돈 {p.money:,} G · 평판 {p.reputation}")
        for line, sk in p.skills.items():
            if sk.level > 1 or sk.xp or line in p.jobs:
                job = p.jobs.get(line)
                tag = f" · {job.rank.name} (직업 임무 {job.job_missions}, 의뢰 {job.requests_done})" if job else ""
                self.out(f"  {line.value} Lv {sk.level} ({sk.xp} XP){tag}")
        if p.equipment:
            self.out("  장비: " + ", ".join(e.name for e in p.equipment))
        if p.businesses:
            self.out(f"  사업: {', '.join(b.line.value for b in p.businesses)} (유지비 {p.upkeep():.0f} G/정산)")
        hot = [
            f"{e.item.name} ×{e.price / e.item.base_price:.2f}"
            for e in w.market.values()
            if abs(e.price - e.item.base_price) > 0.01
        ]
        if hot:
            self.out("  시세 변동: " + ", ".join(hot))

    def missions(self):
        if self.menu_tick != self.world.tick:  # 틱마다 한 번만 생성
            menu = []
            for t in TEMPLATES.values():
                if t.type is MissionType.ROUTINE and (t.tier is Tier.HOBBY or t.line in self.p.jobs):
                    menu.append(self.board.routine(t.id))
            menu += [x for x in self.board.postings.values() if x.template.type is not MissionType.ROUTINE]
            self.menu, self.menu_tick = menu, self.world.tick
        shown = 0
        for i, x in enumerate(self.menu, 1):
            if x.mission.id not in self.board.postings:
                continue
            ok = x.mission.available_to(self.p)
            if not ok and x.template.tier is not Tier.HOBBY and x.template.line not in self.p.jobs:
                continue  # 아직 먼 직업 임무는 숨김
            left = f" · 남은 {x.deadline - self.world.tick}틱" if x.deadline else ""
            lock = "" if ok else " (잠김)"
            chain = f" ★{x.chain.chain.name}" if x.chain else ""
            self.out(
                f"{i:3d}. [{x.template.line.value}/{x.template.type.value}] {x.template.name} "
                f"{x.mission.reward} G{left}{chain}{lock}"
            )
            shown += 1
        if not shown:
            self.out("할 수 있는 임무가 없습니다.")

    def flush_log(self):
        new = self.board.log_total - self.log_seen
        for line in self.board.log[-new:] if new > 0 else []:
            self.out("  ! " + line.split("] ", 1)[1])
        self.log_seen = self.board.log_total

    # ── 행동 ─────────────────────────────────────────
    def do(self, idx: int):
        if self.menu_tick != self.world.tick or not 1 <= idx <= len(self.menu):
            self.out("먼저 m으로 목록을 보세요.")
            return
        x = self.menu[idx - 1]
        if x.mission.id not in self.board.postings:
            self.out("이미 사라진 임무입니다.")
            return
        if not x.mission.available_to(self.p):
            self.out("조건 미충족 (직급 또는 장비)")
            return
        p, t = self.p, x.template
        before_lv = p.skills[t.line].level
        done = self.board.complete(x.mission.id, p)
        reward = done.reward
        msg = f"{t.name} 완료: +{reward} G"
        if t.tier is Tier.HOBBY:
            self.tax_carry += reward * SALES_TAX
            tax, self.tax_carry = int(self.tax_carry), self.tax_carry % 1
            p.money -= tax
            if tax:
                msg += f" (판매세 −{tax})"
        elif t.tier is Tier.JOB:
            pay = round(p.jobs[t.line].hourly_pay * TICK_H)
            p.money += pay
            self.worked_today = True
            msg += f", 급여 +{pay} G"
        p.reputation = min(100, sum(j.requests_done for j in p.jobs.values()))
        self.out(msg)
        if done.drop:
            d = done.drop
            if d.registered:
                self.out(
                    f"  ◆ 도감 등록: {d.item.name} ({d.item.rarity.value})"
                    f" → {d.item.line.value} 경험치 ×{p.xp_mult(d.item.line):.2f}"
                )
            else:
                self.out(f"  ◇ 중복 {d.item.name} 판매 +{d.sold_for} G")
        if p.skills[t.line].level > before_lv:
            self.out(f"  ▲ {t.line.value} Lv {p.skills[t.line].level}")
            if p.can_take_job(t.line) and t.line not in p.jobs:
                self.out(f"  → 직업 자격 획득! 'job {t.line.value}'")
        self.risk(t.line, hobby=t.tier is Tier.HOBBY)
        self.advance()

    def risk(self, line: Line, hobby: bool):
        if line not in RISKY:
            return
        if self.rng.random() < DEATH_P:
            lost = round(max(self.p.money, 0) * DEATH_MONEY_LOSS)
            self.p.on_death()
            self.out(f"  ✖ 쓰러졌습니다. 소지금 −{lost} G, 치료비 −300 G, 장비 내구도 감소")
        elif self.rng.random() < INJURY_P:
            fee = round(self.rng.randint(50, 300) * (HOBBY_MEDICAL_DISCOUNT if hobby else 1))
            self.p.money -= fee
            self.out(f"  ✚ 부상, 치료비 −{fee} G")

    def advance(self):
        self.world.total_businesses = len(self.p.businesses)
        self.board.update()
        if self.world.tick % TICKS_PER_DAY == 0:
            self.settle()
        self.flush_log()

    def settle(self):
        p = self.p
        lines = []
        self.worked_today = False
        if p.equipment:
            c = round(max(e.repair_cost() for e in p.equipment))
            p.money -= c
            lines.append(f"수리비 −{c}")
        if p.businesses:
            rev = BUSINESS_REVENUE * len(p.businesses) * self.rng.uniform(0.7, 1.3)
            for b in p.businesses:
                rev += self.world.biz_bonus.pop(b.line, 0)
            tax, up = rev * BUSINESS_TAX, p.upkeep()
            net = round(rev - tax - up)
            p.money += net
            lines.append(f"사업 매출 {rev:.0f} − 세금 {tax:.0f} − 유지비 {up:.0f} = {net:+}")
        self.out(f"── {self.world.tick // TICKS_PER_DAY}일차 정산: " + (", ".join(lines) or "없음"))

    def buy(self, idx: int):
        if not 1 <= idx <= len(SHOP):
            self.out("없는 상품입니다.")
            return
        name, price = SHOP[idx - 1]
        if self.p.money < price:
            self.out(f"돈이 부족합니다 ({price:,} G)")
            return
        self.p.money -= price
        self.p.equipment.append(Equipment(name, price))
        self.out(f"{name} 구매 (−{price:,} G)")

    def line_cmd(self, cmd: str, name: str):
        line = LINE_BY_NAME.get(name)
        if line is None:
            self.out("계열: " + ", ".join(LINE_BY_NAME))
            return
        try:
            if cmd == "job":
                self.p.take_job(line)
                self.out(f"{line.value} 직업을 시작합니다 (견습)")
            elif cmd == "up":
                missing = self.p.promote_missing(line)
                if missing:
                    self.out("승급 조건 부족: " + ", ".join(missing))
                    return
                r = self.p.promote(line)
                self.out(f"{line.value} {r.name} 승급!")
            elif cmd == "biz":
                self.p.open_business(line)
                self.out(f"{line.value} 사업 개설 (−{BUSINESS_OPEN_COST:,} G)")
        except ValueError as e:
            self.out(f"불가: {e}")

    def save(self, path: str):
        from tools.save import save_game

        save_game(self, path)
        self.out(f"저장 완료: {path}")

    def load(self, path: str):
        from tools.save import load_game

        try:
            loaded = load_game(path, out=self.out)
        except (OSError, ValueError, KeyError) as e:
            self.out(f"불러오기 실패: {e}")
            return
        self.__dict__.update(loaded.__dict__)  # 현재 객체를 불러온 상태로 교체
        self.out(f"불러오기 완료: {path}")
        self.status()

    def dex(self):
        for line, owned, total, mult in collection.progress(self.p.collection):
            self.out(f"  {line.value}: {owned}/{total} · 경험치 ×{mult:.2f}")

    # ── 입력 처리 ─────────────────────────────────────
    def handle(self, raw: str) -> bool:
        parts = raw.strip().split()
        if not parts:
            return True
        c = parts[0].lower()
        if c in ("q", "quit", "exit"):
            self.save(DEFAULT_SAVE)
            return False
        if c in ("save", "load"):
            path = parts[1] if len(parts) > 1 else DEFAULT_SAVE
            self.save(path) if c == "save" else self.load(path)
            return True
        if c.isdigit():
            self.do(int(c))
        elif c in ("s", "상태"):
            self.status()
        elif c in ("m", "임무"):
            self.missions()
        elif c == "wait":
            self.advance()
            self.out("한 틱 쉬었습니다.")
        elif c == "shop":
            for i, (n, pr) in enumerate(SHOP, 1):
                self.out(f"{i}. {n} {pr:,} G")
        elif c == "buy" and len(parts) > 1 and parts[1].isdigit():
            self.buy(int(parts[1]))
        elif c in ("job", "up", "biz") and len(parts) > 1:
            self.line_cmd(c, parts[1])
        elif c == "dex":
            self.dex()
        elif c == "log":
            self.out("\n".join(self.board.log[-10:]) or "사건 없음")
        else:
            self.out(HELP)
        return True


def main():
    g = Game()
    print("일상 임무 게임 프로토타입. help로 명령어 확인. (이어하기: load)")
    g.status()
    while True:
        try:
            raw = input("> ")
        except EOFError:
            break
        if not g.handle(raw):
            break


if __name__ == "__main__":
    sys.exit(main())
