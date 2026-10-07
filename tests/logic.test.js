// Запуск: node --test tests/logic.test.js
// Логика берётся из index.html между маркерами // <logic> и // </logic>
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('// <logic>')[1].split('// </logic>')[0];
const Y = vm.runInNewContext(code + ';Yahtzee');
// Массивы из контекста vm имеют другой прототип — приводим к обычным для deepEqual
const plain = (x) => JSON.parse(JSON.stringify(x));

// Игрок с заранее заполненными клетками
function playerWith(scores, bonuses) {
  const p = Y.createPlayer('Тест');
  Object.assign(p.scores, scores);
  p.yahtzeeBonuses = bonuses || 0;
  return p;
}

test('фулл-хаус: пять одинаковых без жокера дают 0', () => {
  assert.equal(Y.scoreRaw('fullHouse', [4, 4, 4, 4, 4]), 0);
  assert.equal(Y.possibleScore(Y.createPlayer('a'), 'fullHouse', [4, 4, 4, 4, 4]), 0);
});

test('фулл-хаус: пять одинаковых при жокере дают 25', () => {
  const p = playerWith({ yahtzee: 50 });
  assert.equal(Y.possibleScore(p, 'fullHouse', [4, 4, 4, 4, 4]), 25);
});

test('фулл-хаус: обычный 3+2 даёт 25', () => {
  assert.equal(Y.scoreRaw('fullHouse', [2, 2, 5, 5, 5]), 25);
  assert.equal(Y.scoreRaw('fullHouse', [2, 2, 5, 5, 6]), 0);
});

test('малый стрит с повтором считается', () => {
  assert.equal(Y.scoreRaw('smallStraight', [1, 2, 2, 3, 4]), 30);
  assert.equal(Y.scoreRaw('smallStraight', [3, 4, 4, 5, 6]), 30);
  assert.equal(Y.scoreRaw('smallStraight', [1, 2, 3, 5, 6]), 0);
});

test('большой стрит: только пять подряд', () => {
  assert.equal(Y.scoreRaw('largeStraight', [2, 3, 4, 5, 6]), 40);
  assert.equal(Y.scoreRaw('largeStraight', [1, 2, 3, 4, 6]), 0);
  assert.equal(Y.scoreRaw('largeStraight', [1, 2, 2, 3, 4]), 0);
});

test('ноль в категории, если комбинации нет', () => {
  assert.equal(Y.scoreRaw('fourKind', [1, 1, 1, 2, 3]), 0);
  assert.equal(Y.scoreRaw('threeKind', [1, 1, 2, 2, 3]), 0);
  assert.equal(Y.scoreRaw('yahtzee', [1, 1, 1, 1, 2]), 0);
  assert.equal(Y.scoreRaw('sixes', [1, 2, 3, 4, 5]), 0);
});

test('сет, каре, шанс считают сумму кубиков; верхняя секция — сумму граней', () => {
  assert.equal(Y.scoreRaw('threeKind', [3, 3, 3, 1, 6]), 16);
  assert.equal(Y.scoreRaw('fourKind', [5, 5, 5, 5, 2]), 22);
  assert.equal(Y.scoreRaw('chance', [1, 2, 3, 4, 6]), 16);
  assert.equal(Y.scoreRaw('fours', [4, 4, 1, 4, 2]), 12);
  assert.equal(Y.scoreRaw('yahtzee', [6, 6, 6, 6, 6]), 50);
});

test('бонус верхней секции: 63 даёт +35, 62 — нет', () => {
  const at63 = playerWith({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.upperSum(at63), 63);
  assert.equal(Y.upperBonus(at63), 35);
  assert.equal(Y.totalScore(at63), 98);
  const at62 = playerWith({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert.equal(Y.upperSum(at62), 62);
  assert.equal(Y.upperBonus(at62), 0);
  assert.equal(Y.totalScore(at62), 62);
});

test('повторный ятзи: +100 только если в клетке «Ятзи» стоит 50', () => {
  const dice = [3, 3, 3, 3, 3];
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 50 }), dice), true);
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 0 }), dice), false);
  assert.equal(Y.earnsYahtzeeBonus(Y.createPlayer('a'), dice), false);
  assert.equal(Y.earnsYahtzeeBonus(playerWith({ yahtzee: 50 }), [3, 3, 3, 3, 2]), false);
});

test('повторный ятзи в партии даёт бонус 100 и записывается по жокеру', () => {
  const g = Y.createGame(['A', 'B']);
  g.players[0].scores.yahtzee = 50;
  g.dice = [3, 3, 3, 3, 3];
  g.rollsUsed = 1;
  assert.deepEqual(plain(Y.allowedCategories(g.players[0], g.dice)), ['threes']);
  assert.equal(Y.scoreCategory(g, 'threes'), true);
  assert.equal(g.players[0].scores.threes, 15);
  assert.equal(g.players[0].yahtzeeBonuses, 1);
  assert.equal(Y.totalScore(g.players[0]), 50 + 15 + 100);
  assert.equal(g.current, 1);
});

test('жокер: соответствующая верхняя занята — любая нижняя; нижние заняты — любая верхняя', () => {
  const dice = [6, 6, 6, 6, 6];
  const lowerFilled = {};
  ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance'].forEach((c) => { lowerFilled[c] = 0; });
  const p1 = playerWith({ yahtzee: 0, sixes: 18 });
  assert.deepEqual(plain(Y.allowedCategories(p1, dice)), ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance']);
  assert.equal(Y.possibleScore(p1, 'largeStraight', dice), 40);
  assert.equal(Y.possibleScore(p1, 'smallStraight', dice), 30);
  const p2 = playerWith(Object.assign({ yahtzee: 50, sixes: 18 }, lowerFilled));
  assert.deepEqual(plain(Y.allowedCategories(p2, dice)), ['ones', 'twos', 'threes', 'fours', 'fives']);
  assert.equal(Y.possibleScore(p2, 'ones', dice), 0);
});

test('без жокера ятзи можно записать в любую свободную клетку', () => {
  const p = Y.createPlayer('a');
  assert.equal(Y.allowedCategories(p, [2, 2, 2, 2, 2]).length, 13);
});

test('бросок: до трёх раз за ход, зафиксированные кубики не меняются', () => {
  const g = Y.createGame(['A']);
  assert.equal(Y.toggleHold(g, 0), false, 'до броска фиксировать нельзя');
  let seq = [1, 2, 3, 4, 5].map((v) => (v - 0.5) / 6);
  let i = 0;
  assert.equal(Y.roll(g, () => seq[i++ % 5]), true);
  assert.deepEqual(plain(g.dice), [1, 2, 3, 4, 5]);
  assert.equal(Y.toggleHold(g, 0), true);
  assert.equal(Y.roll(g, () => 0.99), true);
  assert.deepEqual(plain(g.dice), [1, 6, 6, 6, 6]);
  assert.equal(Y.toggleHold(g, 0), true, 'снять фиксацию');
  assert.equal(g.held[0], false);
  assert.equal(Y.roll(g, () => 0.99), true);
  assert.equal(Y.rollsLeft(g), 0);
  assert.equal(Y.roll(g, () => 0.99), false, 'четвёртого броска нет');
  assert.equal(Y.toggleHold(g, 0), false, 'после третьего фиксировать нельзя');
});

test('нельзя записать до броска и дважды в одну клетку', () => {
  const g = Y.createGame(['A', 'B']);
  assert.equal(Y.scoreCategory(g, 'chance'), false);
  Y.roll(g);
  assert.equal(Y.scoreCategory(g, 'chance'), true);
  g.current = 0;
  Y.roll(g);
  assert.equal(Y.scoreCategory(g, 'chance'), false);
});

test('игра заканчивается, когда заполнены все клетки у всех игроков', () => {
  const g = Y.createGame(['A', 'B']);
  let turns = 0;
  while (!g.gameOver) {
    Y.roll(g);
    const cat = Y.allowedCategories(g.players[g.current], g.dice)[0];
    assert.equal(Y.scoreCategory(g, cat), true);
    turns++;
    assert.ok(turns <= 26);
  }
  assert.equal(turns, 26);
  assert.ok(g.players.every(Y.isPlayerDone));
  assert.equal(Y.roll(g), false);
});

test('компьютер оставляет самые частые значения (при равенстве — большее)', () => {
  assert.deepEqual(plain(Y.cpuChooseHold([2, 2, 5, 5, 1])), [false, false, true, true, false]);
  assert.deepEqual(plain(Y.cpuChooseHold([3, 3, 3, 1, 6])), [true, true, true, false, false]);
  assert.deepEqual(plain(Y.cpuChooseHold([1, 2, 3, 4, 6])), [false, false, false, false, true]);
});

test('компьютер выбирает категорию с максимумом очков', () => {
  assert.equal(Y.cpuChooseCategory(Y.createPlayer('c'), [2, 2, 5, 5, 5]), 'fullHouse');
  assert.equal(Y.cpuChooseCategory(Y.createPlayer('c'), [1, 2, 3, 4, 5]), 'largeStraight');
  assert.equal(Y.cpuChooseCategory(playerWith({ yahtzee: 50, sixes: 18 }), [6, 6, 6, 6, 6]), 'largeStraight');
});
