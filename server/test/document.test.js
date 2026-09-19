import test from 'node:test';
import assert from 'node:assert/strict';
import { HwpxWriter } from '@ssabrojs/hwpxjs';
import { documentInput } from '../src/document.js';

test('PDF stays a file input and rejects renamed or malformed files', async () => {
  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const parts = await documentInput({ name: '공지.pdf', data: pdf.toString('base64') });
  assert.equal(parts[0].type, 'input_file');
  assert.equal(parts[0].filename, '공지.pdf');
  await assert.rejects(documentInput({ name: '공지.hwp', data: pdf.toString('base64') }), /파일 형식/);
  await assert.rejects(documentInput({ name: '공지.pdf', data: Buffer.from('fake').toString('base64') }), /PDF 파일 형식/);
});

test('HWPX is converted to document text before AI input', async () => {
  const bytes = await new HwpxWriter().createFromPlainText('음악회 2027년 1월 1일 서울');
  const parts = await documentInput({ name: '안내.hwpx', data: Buffer.from(bytes).toString('base64') });
  assert.equal(parts[0].type, 'input_text');
  assert.match(parts[0].text, /음악회/);
  assert.match(parts[0].text, /서울/);
});
