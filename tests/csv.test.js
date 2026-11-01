import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, csvToObjects } from '../js/csv.js';
import { parseQuestions } from '../js/questions.js';

test('quoted fields, escaped quotes, commas and newlines inside quotes', () => {
  assert.deepEqual(parseCSV('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCSV('a\n"multi\nline"\n'), [['a'], ['multi\nline']]);
});

test('BOM, CRLF row endings and blank rows', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n1,2\r\n\r\n,\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a,"b\r\nc"\r\n'), [['a', 'b\r\nc']]);
});

test('ragged rows and missing trailing newline', () => {
  assert.deepEqual(csvToObjects('Question,Answer,Notes\nQ1,A1\nQ2,A2,n'), [
    { question: 'Q1', answer: 'A1', notes: '' }, { question: 'Q2', answer: 'A2', notes: 'n' }]);
  assert.deepEqual(parseCSV('a,"unterminated'), [['a', 'unterminated']]);
});

test('a large bank parses quickly', () => {
  const row = 'x,Set,2025,HS,1,1,TOSS-UP,Physics,Multiple Choice,"A long question, with commas and ""quotes""\n1) and a list",W,X,Y,Z,Y) Y,,,\n';
  const csv = 'id,set,year,level,round,num,type,subject,format,question,w,x,y,z,answer,accept,reject,notes\n' + row.repeat(40000);
  const t = performance.now();
  assert.equal(parseCSV(csv).length, 40001);
  assert.ok(performance.now() - t < 2000, 'parsing 40,000 rows should take well under 2 s');
});

test('different questions whose derived IDs collide are both kept', () => {
  // Same set/round/num/type/question text => same derived ID; different answers => different questions.
  const csv = 'set,round,num,type,question,answer\nS,1,1,TOSS-UP,Q,A\nS,1,1,TOSS-UP,Q,A\nS,1,1,TOSS-UP,Q,B\n';
  const qs = parseQuestions(csv);
  assert.equal(qs.length, 2, 'exact duplicate dropped, different question kept');
  assert.notEqual(qs[0].id, qs[1].id);
});
