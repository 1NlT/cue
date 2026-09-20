import 'package:cue/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('first launch shows usage and personal settings together', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const CueApp());
    expect(find.text('사진 한 장에서 시작되는 일정'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('Cue 시작하기'), findsOneWidget);
    expect(find.text('사용 방법'), findsOneWidget);
    expect(find.text('기본 설정'), findsOneWidget);
    expect(find.text('관심사 기반 행사 추천'), findsOneWidget);
    expect(find.text('포스터 촬영하기'), findsNothing);
  });

  testWidgets('completed setup opens scan without repeated instructions', (tester) async {
    SharedPreferences.setMockInitialValues({'cue_onboarding_completed': true});
    await tester.pumpWidget(const CueApp());
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('포스터 촬영하기'), findsOneWidget);
    expect(find.text('사진첩에서 선택'), findsOneWidget);
    expect(find.text('PDF·한글 파일 열기'), findsNothing);
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(find.text('PDF·한글 파일 열기'), findsOneWidget);
    Navigator.of(tester.element(find.text('PDF·한글 파일 열기'))).pop();
    await tester.pumpAndSettle();
    expect(find.text('사용 방법'), findsNothing);
    expect(find.text('내 일정'), findsOneWidget);
    expect(find.text('추천'), findsOneWidget);
  });
}
