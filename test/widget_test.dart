import 'package:cue/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('shows the core scan journey and navigation', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const CueApp());
    expect(find.text('사진 한 장에서 시작되는 일정'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('포스터 촬영하기'), findsOneWidget);
    expect(find.text('사진첩에서 선택'), findsOneWidget);
    expect(find.text('PDF·한글 파일 열기'), findsOneWidget);
    expect(find.text('내 일정'), findsOneWidget);
    expect(find.text('발견'), findsOneWidget);
    await tester.tap(find.text('설정').last);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('기본 알림'), findsOneWidget);
    expect(find.text('기본 일정 길이'), findsOneWidget);
    expect(find.text('선택을 기억해 추천'), findsOneWidget);
    expect(find.text('큰 글씨'), findsNothing);
  });
}
