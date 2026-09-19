import 'package:cue/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('camera splash and dark theme setting', (tester) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const CueApp());
    expect(find.text('사진 한 장에서 시작되는 일정'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('사진 한 장으로,\n일정이 되다.'), findsOneWidget);
    await tester.tap(find.text('설정').last);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('다크'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(cueThemeMode.value, ThemeMode.dark);
    expect(Theme.of(tester.element(find.byType(CueHome))).brightness, Brightness.dark);
  });
}
