import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_calendar/device_calendar.dart' as calendar;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:url_launcher/url_launcher.dart';

import 'cue_api.dart';
import 'cue_categories.dart';
import 'cue_splash.dart';
import 'saved_event_editor.dart';

const ink = Color(0xFF17344E);
const muted = Color(0xFF65809A);
const paper = Color(0xFFF4FAFF);
const accent = Color(0xFF238BD0);
const mint = Color(0xFFE5F4FF);
final cueThemeMode = ValueNotifier<ThemeMode>(ThemeMode.system);
const cueApiUrl = String.fromEnvironment(
  'CUE_API_URL',
  defaultValue: 'http://localhost:8787',
);

ThemeData cueTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final background = dark ? const Color(0xFF0B1928) : paper;
  final surface = dark ? const Color(0xFF15283A) : Colors.white;
  final foreground = dark ? const Color(0xFFEDF7FF) : ink;
  final blue = dark ? const Color(0xFF75C9FF) : accent;
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: background,
    colorScheme: ColorScheme.fromSeed(
      seedColor: blue,
      brightness: brightness,
      surface: surface,
    ),
    textTheme: TextTheme(
      headlineLarge: TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.w800,
        color: foreground,
        height: 1.2,
      ),
      titleLarge: TextStyle(
        fontSize: 19,
        fontWeight: FontWeight.w800,
        color: foreground,
      ),
      bodyMedium: TextStyle(fontSize: 15, color: foreground, height: 1.5),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 17, vertical: 16),
    ),
  );
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (useSupabaseAuth) {
    await Supabase.initialize(
      url: supabaseUrl,
      publishableKey: supabasePublishableKey,
    );
  }
  runApp(const CueApp());
}

class CueApp extends StatelessWidget {
  const CueApp({super.key});
  @override
  Widget build(BuildContext context) => ValueListenableBuilder<ThemeMode>(
    valueListenable: cueThemeMode,
    builder: (_, mode, _) => MaterialApp(
      title: 'Cue',
      debugShowCheckedModeBanner: false,
      theme: cueTheme(Brightness.light),
      darkTheme: cueTheme(Brightness.dark),
      themeMode: mode,
      home: const CueHome(),
    ),
  );
}

enum ScanStage { idle, processing, notEvent, review, saved }

class CueDocument {
  CueDocument(this.path, this.name);
  final String path;
  final String name;
  int? lengthSync() => File(path).lengthSync();
  Future<int?> length() async => File(path).length();
  Future<List<int>> readAsBytes() => File(path).readAsBytes();
}

class CueHome extends StatefulWidget {
  const CueHome({super.key});
  @override
  State<CueHome> createState() => _CueHomeState();
}

class _CueHomeState extends State<CueHome> with WidgetsBindingObserver {
  static const shareChannel = MethodChannel('cue/shared');
  bool get isDark => Theme.of(context).brightness == Brightness.dark;
  Color get ink => isDark ? Color(0xFFEDF7FF) : Color(0xFF17344E);
  Color get muted => isDark ? Color(0xFFA2BDD0) : Color(0xFF65809A);
  Color get paper => isDark ? Color(0xFF0B1928) : Color(0xFFF4FAFF);
  Color get accent => isDark ? Color(0xFF75C9FF) : Color(0xFF238BD0);
  Color get mint => isDark ? Color(0xFF193D58) : Color(0xFFE5F4FF);
  Color get surface => isDark ? Color(0xFF15283A) : Colors.white;
  Color get borderColor => isDark ? Color(0xFF2B4861) : Color(0xFFDCEBF5);
  Color get cameraCard => isDark ? Color(0xFF173D58) : Color(0xFF146DAB);

  final api = CueApi(cueApiUrl);
  final picker = ImagePicker();
  final calendarPlugin = calendar.DeviceCalendarPlugin();
  final titleController = TextEditingController();
  final venueController = TextEditingController();
  final deadlineController = TextEditingController();
  final feeController = TextEditingController();
  bool showUnknownInputs = false;
  int tab = 0;
  ScanStage stage = ScanStage.idle;
  File? image;
  CueDocument? document;
  CueEvent? candidate;
  int? selectedSession;
  DateTime? startsAt;
  DateTime? endsAt;
  int reminderMinutes = 60;
  int defaultReminderMinutes = 60;
  int defaultDurationMinutes = 120;
  String? preferredCalendarId;
  String preferredCalendarName = '기기 기본 캘린더';
  String selectedCategory = '기타';
  bool loading = true;
  bool saving = false;
  bool personalizationEnabled = true;
  bool recommendationEnabled = true;
  bool recommendationLoading = false;
  String? userId;
  bool cloudConnected = false;
  String? busyEventId;
  String? statusMessage;
  String? apiError;
  List<Map<String, dynamic>> saved = [];
  List<Map<String, dynamic>> recommended = [];
  Timer? progressTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _boot();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_takeSharedFile());
  }

  Future<void> _takeSharedFile() async {
    if (!Platform.isIOS || loading) return;
    try {
      final path = await shareChannel.invokeMethod<String>('takeSharedFile');
      if (path == null || !mounted) return;
      final shared = File(path);
      if (!await shared.exists()) return;
      final extension = path.toLowerCase();
      setState(() {
        tab = 0;
        stage = ScanStage.idle;
        candidate = null;
        if (extension.endsWith('.pdf')) {
          document = CueDocument(path, '공유한 문서.pdf');
          image = null;
        } else {
          image = shared;
          document = null;
        }
      });
      await _analyze();
    } catch (error) { _message('공유 파일을 열지 못했습니다: $error'); }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    progressTimer?.cancel();
    titleController.dispose();
    venueController.dispose();
    deadlineController.dispose();
    feeController.dispose();
    super.dispose();
  }

  Future<void> _boot() async {
    final minimum = Future<void>.delayed(Duration(milliseconds: 1100));
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    cueThemeMode.value = switch (prefs.getString('theme_mode')) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    defaultReminderMinutes = prefs.getInt('default_reminder_minutes') ?? 60;
    reminderMinutes = defaultReminderMinutes;
    defaultDurationMinutes = prefs.getInt('default_duration_minutes') ?? 120;
    preferredCalendarId = prefs.getString('preferred_calendar_id');
    preferredCalendarName =
        prefs.getString('preferred_calendar_name') ?? '기기 기본 캘린더';
    await minimum;
    if (!mounted) return;
    setState(() => loading = false);
    unawaited(() async { await _refresh(); await _takeSharedFile(); }());
  }

  Future<void> _refresh() async {
    if (mounted) setState(() => recommendationLoading = true);
    try {
      await api.init();
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getStringList('pending_event_deletions') ?? [];
      for (final id in pending) {
        try {
          await api.delete('/v1/events/$id');
        } on CueApiException catch (error) {
          if (error.status != 404) break;
        }
        await prefs.setStringList(
          'pending_event_deletions',
          (prefs.getStringList('pending_event_deletions') ?? [])..remove(id),
        );
      }
      final me = await api.get('/v1/me');
      final recs = await api.get('/v1/recommendations');
      if (!mounted) return;
      setState(() {
        final profile = me['profile'] as Map<String, dynamic>? ?? {};
        userId = me['userId'] as String?;
        cloudConnected = me['cloudConnected'] as bool? ?? false;
        personalizationEnabled =
            profile['personalizationEnabled'] as bool? ?? true;
        recommendationEnabled =
            profile['recommendationEnabled'] as bool? ?? true;
        final pendingIds =
            (prefs.getStringList('pending_event_deletions') ?? []).toSet();
        saved = (me['saved'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>()
            .where((event) => !pendingIds.contains(event['id']))
            .toList();
        recommended = (recs['events'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
        recommendationLoading = false;
        apiError = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          recommendationLoading = false;
          apiError = error.toString();
        });
      }
    }
  }

  Future<void> _pick(ImageSource source) async {
    try {
      final picked = await picker.pickImage(
        source: source,
        imageQuality: 78,
        maxWidth: 1800,
      );
      if (picked == null || !mounted) return;
      setState(() {
        image = File(picked.path);
        document = null;
        stage = ScanStage.idle;
        statusMessage = null;
      });
      await _analyze();
    } catch (error) {
      _message('사진을 열지 못했습니다: $error');
    }
  }

  Future<void> _pickDocument() async {
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'hwp', 'hwpx'],
      );
      if (files.isEmpty || !mounted) return;
      final picked = files.single;
      if (picked.path == null) throw CueApiException('문서 경로를 읽지 못했습니다. 다시 선택해 주세요.');
      final length = picked.lengthSync() ?? await picked.length();
      if (length == null || length == 0 || length > 10 * 1024 * 1024) {
        throw CueApiException('10MB 이하의 PDF 또는 한글 파일을 선택해 주세요.');
      }
      if (!mounted) return;
      setState(() {
        document = CueDocument(picked.path!, picked.name);
        image = null;
        stage = ScanStage.idle;
        statusMessage = null;
      });
      await _analyze();
    } catch (error) {
      _message('문서를 열지 못했습니다: $error');
    }
  }

  Future<void> _analyze() async {
    if (image == null && document == null) return;
    if (apiError != null) {
      await _refresh();
      if (apiError != null) {
        _message(apiError!);
        return;
      }
    }
    setState(() {
      stage = ScanStage.processing;
      statusMessage = '행사 안내물인지 확인하는 중';
    });
    progressTimer?.cancel();
    progressTimer = Timer(Duration(seconds: 4), () {
      if (mounted && stage == ScanStage.processing) {
        setState(() => statusMessage = '행사라면 시간과 장소를 정리하는 중');
      }
    });
    try {
      final source = <String, dynamic>{};
      if (document != null) {
        final bytes = await document!.readAsBytes();
        if (bytes.isEmpty || bytes.length > 10 * 1024 * 1024) {
          throw CueApiException('10MB 이하의 PDF 또는 한글 파일을 선택해 주세요.');
        }
        source['file'] = {'name': document!.name, 'data': base64Encode(bytes)};
      } else {
        final bytes = await image!.readAsBytes();
        if (bytes.length > 5 * 1024 * 1024) {
          throw CueApiException('사진이 너무 큽니다. 5MB 이하 이미지를 선택해 주세요.');
        }
        final ext = image!.path.toLowerCase();
        final mime = ext.endsWith('.png')
            ? 'png'
            : ext.endsWith('.webp')
            ? 'webp'
            : 'jpeg';
        source['image'] = 'data:image/$mime;base64,${base64Encode(bytes)}';
      }
      final result = await api.post('/v1/analyze', {
        ...source,
        'timezoneOffsetMinutes': DateTime.now().timeZoneOffset.inMinutes,
        'defaultDurationMinutes': defaultDurationMinutes,
      });
      if (!mounted) return;
      if (result['status'] != 'event') {
        setState(() {
          stage = ScanStage.notEvent;
          candidate = null;
        });
        return;
      }
      final event = CueEvent.fromJson(result['event'] as Map<String, dynamic>);
      setState(() {
        candidate = event;
        stage = ScanStage.review;
        titleController.text = event.title;
        selectedCategory = event.category;
        deadlineController.text = event.applicationDeadline == null ? '' : event.applicationDeadline!.substring(0, 10);
        feeController.text = event.participationFee ?? '';
        showUnknownInputs = false;
        selectedSession = event.sessions.length == 1 ? 0 : null;
        _applySession(selectedSession);
      });
    } catch (error) {
      if (mounted) {
        setState(() => stage = ScanStage.idle);
        _message(error.toString());
      }
    } finally {
      progressTimer?.cancel();
    }
  }

  void _applySession(int? index) {
    if (index == null || candidate == null) {
      startsAt = null;
      endsAt = null;
      venueController.text = '';
      return;
    }
    final value = candidate!.sessions[index];
    startsAt = value.startsAt;
    endsAt = value.endsAt;
    venueController.text = value.venue;
  }

  Future<void> _chooseDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: startsAt ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: startsAt == null
          ? TimeOfDay.now()
          : TimeOfDay.fromDateTime(startsAt!),
    );
    if (!mounted || time == null) return;
    setState(() {
      startsAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
      endsAt = startsAt!.add(Duration(minutes: defaultDurationMinutes));
    });
  }

  Future<void> _chooseCalendar() async {
    try {
      final permission = await calendarPlugin.requestPermissions();
      if (permission.data != true) throw CueApiException('캘린더 권한이 필요합니다.');
      final result = await calendarPlugin.retrieveCalendars();
      final calendars =
          result.data
              ?.where((item) => item.isReadOnly != true && item.id != null)
              .toList() ??
          [];
      if (!mounted) return;
      final chosen = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              ListTile(
                leading: Icon(Icons.phone_iphone, color: accent),
                title: Text('기기 기본 캘린더'),
                onTap: () => Navigator.pop(sheetContext, ''),
              ),
              for (final item in calendars)
                ListTile(
                  leading: Icon(Icons.calendar_month_outlined, color: accent),
                  title: Text(item.name ?? '이름 없는 캘린더'),
                  subtitle: item.isDefault == true ? Text('기기 기본값') : null,
                  onTap: () => Navigator.pop(sheetContext, item.id),
                ),
            ],
          ),
        ),
      );
      if (!mounted || chosen == null) return;
      final selected = calendars.where((item) => item.id == chosen).firstOrNull;
      setState(() {
        preferredCalendarId = chosen.isEmpty ? null : chosen;
        preferredCalendarName = selected?.name ?? '기기 기본 캘린더';
      });
      final prefs = await SharedPreferences.getInstance();
      if (preferredCalendarId == null) {
        await prefs.remove('preferred_calendar_id');
      } else {
        await prefs.setString('preferred_calendar_id', preferredCalendarId!);
      }
      await prefs.setString('preferred_calendar_name', preferredCalendarName);
    } catch (error) {
      _message(error.toString());
    }
  }

  Future<void> _save() async {
    if (candidate == null) return;
    if (candidate!.sessions.length > 1 && selectedSession == null) {
      _message('시간과 장소 중 하나를 선택해 주세요.');
      return;
    }
    final title = titleController.text.trim();
    final venue = venueController.text.trim();
    if (title.isEmpty || venue.isEmpty || startsAt == null || endsAt == null) {
      _message('행사 이름, 장소, 시간을 확인해 주세요.');
      return;
    }
    if (!endsAt!.isAfter(startsAt!)) {
      _message('종료 시간이 시작 시간보다 빨라요.');
      return;
    }
    if (deadlineController.text.trim().isNotEmpty &&
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(deadlineController.text.trim())) {
      _message('신청 마감일은 YYYY-MM-DD 형식으로 입력해 주세요.');
      return;
    }
    setState(() => saving = true);
    try {
      final permission = await calendarPlugin.requestPermissions();
      if (permission.data != true) {
        throw CueApiException('캘린더 권한이 필요합니다. 기기 설정에서 허용해 주세요.');
      }
      final list = await calendarPlugin.retrieveCalendars();
      final calendars =
          list.data
              ?.where((item) => item.isReadOnly != true && item.id != null)
              .toList() ??
          [];
      if (calendars.isEmpty) throw CueApiException('저장할 수 있는 캘린더가 없습니다.');
      final target =
          calendars
              .where((item) => item.id == preferredCalendarId)
              .firstOrNull ??
          calendars.where((item) => item.isDefault == true).firstOrNull ??
          calendars.first;
      final event = calendar.Event(
        target.id,
        title: title,
        location: venue,
        description: candidate!.description,
        start: tz.TZDateTime.from(startsAt!, tz.UTC),
        end: tz.TZDateTime.from(endsAt!, tz.UTC),
        reminders: reminderMinutes == -1
            ? []
            : [calendar.Reminder(minutes: reminderMinutes)],
      );
      final result = await calendarPlugin.createOrUpdateEvent(event);
      if (result?.isSuccess != true || result?.data == null) {
        throw CueApiException('캘린더 저장에 실패했습니다.');
      }
      if (!mounted) return;
      setState(() => stage = ScanStage.saved);
      try {
        await api.post('/v1/events', {
          'title': title,
          'venue': venue,
          'startsAt': startsAt!.toUtc().toIso8601String(),
          'endsAt': endsAt!.toUtc().toIso8601String(),
          'category': selectedCategory,
          'description': candidate!.description,
          'tags': candidate!.tags,
          'format': candidate!.format,
          'domains': candidate!.domains,
          'applicationDeadline': deadlineController.text.trim().isEmpty
              ? null : DateTime.tryParse('${deadlineController.text.trim()}T23:59:00')?.toUtc().toIso8601String(),
          'participationFee': feeController.text.trim().isEmpty ? null : feeController.text.trim(),
          'calendarId': target.id,
          'calendarEventId': result!.data,
          'reminderMinutes': reminderMinutes,
        });
        await _refresh();
      } catch (_) {
        _message('캘린더에는 저장됐지만 추천 기록 동기화에 실패했습니다.');
      }
    } catch (error) {
      _message(error.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<calendar.Event> _resolveSavedEvent(
    Map<String, dynamic> savedEvent,
  ) async {
    final permission = await calendarPlugin.requestPermissions();
    if (permission.data != true) {
      throw CueApiException('캘린더 권한이 필요합니다. 기기 설정에서 허용해 주세요.');
    }
    final calendarId = savedEvent['calendarId'] as String?;
    final eventId = savedEvent['calendarEventId'] as String?;
    if (calendarId != null && eventId != null) {
      final result = await calendarPlugin.retrieveEvents(
        calendarId,
        calendar.RetrieveEventsParams(eventIds: [eventId]),
      );
      final matches =
          result.data?.where((item) => item.eventId == eventId).toList() ?? [];
      if (result.isSuccess != true || matches.length != 1) {
        throw CueApiException('연결된 캘린더 일정을 찾지 못했습니다. 캘린더에서 직접 확인해 주세요.');
      }
      return matches.single;
    }
    // Records saved before calendar IDs were stored can be linked only by a unique exact match.
    final calendars = await calendarPlugin.retrieveCalendars();
    if (calendars.isSuccess != true) throw CueApiException('캘린더 목록을 읽지 못했습니다.');
    final start = DateTime.parse(savedEvent['startsAt'] as String);
    final end = DateTime.parse(savedEvent['endsAt'] as String);
    final matches = <calendar.Event>[];
    for (final item in calendars.data ?? []) {
      if (item.id == null || item.isReadOnly == true) continue;
      final result = await calendarPlugin.retrieveEvents(
        item.id,
        calendar.RetrieveEventsParams(
          startDate: start.subtract(Duration(days: 1)),
          endDate: end.add(Duration(days: 1)),
        ),
      );
      if (result.isSuccess != true) continue;
      matches.addAll(
        result.data?.where(
              (event) =>
                  event.eventId != null &&
                  event.title?.trim() == savedEvent['title'] &&
                  event.location?.trim() == savedEvent['venue'] &&
                  event.start != null &&
                  event.end != null &&
                  event.start!.toUtc().difference(start).inSeconds.abs() < 60 &&
                  event.end!.toUtc().difference(end).inSeconds.abs() < 60,
            ) ??
            <calendar.Event>[],
      );
    }
    if (matches.length != 1) {
      throw CueApiException(
        matches.isEmpty
            ? '기존 기록과 일치하는 캘린더 일정을 찾지 못했습니다.'
            : '같은 일정이 여러 개여서 안전하게 선택할 수 없습니다. 캘린더에서 직접 수정해 주세요.',
      );
    }
    return matches.single;
  }

  Future<void> _editSaved(Map<String, dynamic> savedEvent) async {
    final id = savedEvent['id'] as String;
    setState(() => busyEventId = id);
    try {
      final deviceEvent = await _resolveSavedEvent(savedEvent);
      if (!mounted) return;
      setState(() => busyEventId = null);
      final draft = await Navigator.push<SavedEventDraft>(
        context,
        MaterialPageRoute(
          builder: (_) =>
              SavedEventEditor(saved: savedEvent, calendarEvent: deviceEvent),
        ),
      );
      if (draft == null || !mounted) return;
      setState(() => busyEventId = id);
      final previous = calendar.Event(
        deviceEvent.calendarId,
        eventId: deviceEvent.eventId,
        title: deviceEvent.title,
        location: deviceEvent.location,
        description: deviceEvent.description,
        start: deviceEvent.start,
        end: deviceEvent.end,
        reminders: deviceEvent.reminders,
        attendees: deviceEvent.attendees,
        recurrenceRule: deviceEvent.recurrenceRule,
        availability: deviceEvent.availability,
        allDay: deviceEvent.allDay,
        status: deviceEvent.status,
        url: deviceEvent.url,
      );
      deviceEvent.title = draft.title;
      deviceEvent.location = draft.venue;
      deviceEvent.start = tz.TZDateTime.from(draft.startsAt, tz.UTC);
      deviceEvent.end = tz.TZDateTime.from(draft.endsAt, tz.UTC);
      deviceEvent.reminders = draft.reminderMinutes == -1
          ? []
          : [calendar.Reminder(minutes: draft.reminderMinutes)];
      final result = await calendarPlugin.createOrUpdateEvent(deviceEvent);
      if (result?.isSuccess != true) {
        throw CueApiException('캘린더 일정 수정에 실패했습니다.');
      }
      try {
        await api.patch('/v1/events/$id', {
          'title': draft.title,
          'venue': draft.venue,
          'startsAt': draft.startsAt.toUtc().toIso8601String(),
          'endsAt': draft.endsAt.toUtc().toIso8601String(),
          'category': draft.category,
          'format': savedEvent['format'] ?? '기타',
          'domains': savedEvent['domains'] ?? [],
          'description': savedEvent['description'] ?? '',
          'tags': savedEvent['tags'] ?? [],
          'applicationDeadline': savedEvent['applicationDeadline'],
          'participationFee': savedEvent['participationFee'],
          'locationAddress': savedEvent['locationAddress'],
          'sourceUrl': savedEvent['sourceUrl'],
          'calendarId': deviceEvent.calendarId,
          'calendarEventId': result?.data ?? deviceEvent.eventId,
          'reminderMinutes': draft.reminderMinutes,
        });
      } catch (_) {
        final restored = await calendarPlugin.createOrUpdateEvent(previous);
        throw CueApiException(
          restored?.isSuccess == true
              ? '서버 동기화에 실패해 캘린더 변경을 되돌렸습니다. 다시 시도해 주세요.'
              : '서버 동기화와 변경 취소에 실패했습니다. 캘린더 일정을 직접 확인해 주세요.',
        );
      }
      await _refresh();
      _message('캘린더 일정과 알림을 수정했어요.');
    } catch (error) {
      _message(error.toString());
    } finally {
      if (mounted) setState(() => busyEventId = null);
    }
  }

  Future<void> _cancelSaved(Map<String, dynamic> savedEvent) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('일정을 취소할까요?'),
        content: Text('기기 캘린더의 일정과 알림이 삭제되고 Cue의 추천 기록에서도 빠집니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('돌아가기'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('일정 취소'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final id = savedEvent['id'] as String;
    setState(() => busyEventId = id);
    try {
      final deviceEvent = await _resolveSavedEvent(savedEvent);
      final result = await calendarPlugin.deleteEvent(
        deviceEvent.calendarId,
        deviceEvent.eventId,
      );
      if (result.isSuccess != true || result.data != true) {
        throw CueApiException('캘린더에서 일정을 삭제하지 못했습니다.');
      }
      var synced = true;
      try {
        await api.delete('/v1/events/$id');
      } catch (_) {
        synced = false;
        final prefs = await SharedPreferences.getInstance();
        final pending = prefs.getStringList('pending_event_deletions') ?? [];
        if (!pending.contains(id)) {
          await prefs.setStringList('pending_event_deletions', [
            ...pending,
            id,
          ]);
        }
        _message('캘린더 일정과 알림을 삭제했어요. Cue 기록은 연결되면 다시 정리합니다.');
      }
      await _refresh();
      if (synced) _message('일정을 취소했어요.');
    } catch (error) {
      _message(error.toString());
    } finally {
      if (mounted) setState(() => busyEventId = null);
    }
  }

  void _message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  void _reset() {
    setState(() {
      image = null;
      document = null;
      candidate = null;
      stage = ScanStage.idle;
      selectedSession = null;
      startsAt = null;
      endsAt = null;
      selectedCategory = '기타';
      reminderMinutes = defaultReminderMinutes;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return CueSplash();
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            if (apiError != null)
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 20),
                child: _notice(apiError!, onTap: _refresh),
              ),
            Expanded(
              child: IndexedStack(
                index: tab,
                children: [
                  _scroll(_home()),
                  _scroll(_saved()),
                  _scroll(_discover()),
                  _scroll(_settings()),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (value) => setState(() => tab = value),
        backgroundColor: surface,
        indicatorColor: mint,
        destinations: [
          NavigationDestination(
            icon: Icon(Icons.auto_awesome_outlined),
            selectedIcon: Icon(Icons.auto_awesome),
            label: '스캔',
          ),
          NavigationDestination(
            icon: Icon(Icons.event_note_outlined),
            selectedIcon: Icon(Icons.event_note),
            label: '내 일정',
          ),
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: '발견',
          ),
          NavigationDestination(
            icon: Icon(Icons.tune_outlined),
            selectedIcon: Icon(Icons.tune),
            label: '설정',
          ),
        ],
      ),
    );
  }

  Widget _scroll(Widget child) => SingleChildScrollView(
    child: Padding(padding: EdgeInsets.fromLTRB(20, 20, 20, 32), child: child),
  );
  Widget _header() => Padding(
    padding: EdgeInsets.fromLTRB(22, 18, 22, 10),
    child: Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: accent,
            borderRadius: BorderRadius.circular(13),
          ),
          child: Icon(Icons.camera_alt_outlined, color: Colors.white, size: 23),
        ),
        SizedBox(width: 11),
        Text(
          'cue',
          style: TextStyle(
            fontSize: 27,
            fontWeight: FontWeight.w900,
            color: ink,
            letterSpacing: -1.5,
          ),
        ),
      ],
    ),
  );

  Widget _home() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(height: 12),
      Text(
        '사진 한 장으로,\n일정이 되다.',
        style: TextStyle(
          fontSize: 33,
          height: 1.23,
          fontWeight: FontWeight.w900,
          color: ink,
          letterSpacing: -1,
        ),
      ),
      SizedBox(height: 13),
      Text(
        '포스터 사진이나 행사 문서를 보여주면 Cue가 일정을 읽고,\n당신이 확인한 뒤 캘린더에 담아드려요.',
        style: TextStyle(fontSize: 15, height: 1.55, color: muted),
      ),
      SizedBox(height: 28),
      if (stage == ScanStage.idle) _captureCard(),
      if (stage == ScanStage.processing) _progressCard(),
      if (stage == ScanStage.notEvent) _notEventCard(),
      if (stage == ScanStage.review) _reviewCard(),
      if (stage == ScanStage.saved) _savedCard(),
      SizedBox(height: 22),
      if (stage == ScanStage.idle) _stepsCard(),
    ],
  );

  Widget _captureCard() => Container(
    padding: EdgeInsets.all(23),
    decoration: BoxDecoration(
      color: cameraCard,
      borderRadius: BorderRadius.circular(28),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (image != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.file(
              image!,
              height: 145,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
          SizedBox(height: 12),
          _button('이 사진 다시 분석', Icons.refresh, _analyze, light: true),
          SizedBox(height: 18),
        ],
        if (document != null) ...[
          Row(
            children: [
              Icon(Icons.description_outlined, color: Colors.white),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  document!.name,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          SizedBox(height: 12),
          _button('이 문서 다시 분석', Icons.refresh, _analyze, light: true),
          SizedBox(height: 18),
        ],
        Container(
          width: 54,
          height: 54,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Icon(Icons.center_focus_strong, color: Colors.white, size: 29),
        ),
        SizedBox(height: 27),
        Text(
          '행사 안내물을 준비해 주세요',
          style: TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        SizedBox(height: 7),
        Text(
          '사진을 찍거나 PDF·한글 파일을 열 수 있어요.',
          style: TextStyle(color: Color(0xFFD9F0FF)),
        ),
        SizedBox(height: 23),
        _button(
          '포스터 촬영하기',
          Icons.camera_alt_outlined,
          () => _pick(ImageSource.camera),
          light: true,
        ),
        SizedBox(height: 10),
        _button(
          '사진첩에서 선택',
          Icons.photo_library_outlined,
          () => _pick(ImageSource.gallery),
          outlined: true,
        ),
        SizedBox(height: 10),
        _button(
          'PDF·한글 파일 열기',
          Icons.upload_file_outlined,
          _pickDocument,
          outlined: true,
        ),
      ],
    ),
  );

  Widget _progressCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (image != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(17),
            child: Image.file(
              image!,
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
        if (document != null)
          Row(
            children: [
              Icon(Icons.description_outlined, color: accent),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  document!.name,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: ink, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        SizedBox(height: 23),
        Row(
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 3, color: accent),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                statusMessage ?? '분석하는 중',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: ink,
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 9),
        Text(
          'Cue가 안내물을 살펴보고 있어요. 잠시만 기다려 주세요.',
          style: TextStyle(color: muted),
        ),
      ],
    ),
  );

  Widget _notEventCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, color: accent, size: 35),
        SizedBox(height: 15),
        Text(
          '행사 안내물을 찾지 못했어요',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        SizedBox(height: 8),
        Text(
          '이 안내물에 대한 일정 추출은 여기서 멈췄어요. 행사 포스터나 공지문을 다시 보여주세요.',
          style: TextStyle(color: muted, height: 1.5),
        ),
        SizedBox(height: 20),
        _button('다른 안내물 선택', Icons.refresh, () {
          _reset();
        }),
      ],
    ),
  );

  Widget _reviewCard() {
    final event = candidate!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: EdgeInsets.all(17),
          decoration: BoxDecoration(
            color: mint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Icon(Icons.auto_awesome, color: accent),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'AI가 일정을 정리했어요. 저장 전에 꼭 확인해 주세요.',
                  style: TextStyle(color: accent, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
        SizedBox(height: 18),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _eyebrow('01  행사 정보'),
              SizedBox(height: 14),
              TextField(
                controller: titleController,
                decoration: InputDecoration(
                  labelText: '행사 이름',
                  prefixIcon: Icon(Icons.celebration_outlined),
                ),
              ),
              SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: ValueKey('${event.title}-$selectedCategory'),
                initialValue: selectedCategory,
                decoration: InputDecoration(
                  labelText: '행사 종류',
                  prefixIcon: Icon(Icons.category_outlined),
                ),
                items: cueCategories
                    .map(
                      (value) =>
                          DropdownMenuItem(value: value, child: Text(value)),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) setState(() => selectedCategory = value);
                },
              ),
              if (event.description.isNotEmpty) ...[
                SizedBox(height: 12),
                Text(event.description, style: TextStyle(color: muted)),
              ],
              SizedBox(height: 10),
              Text('형식: ${event.format} · 분야: ${event.domains.join('·')}', style: TextStyle(color: muted)),
            ],
          ),
        ),
        SizedBox(height: 14),
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _eyebrow('02  시간과 장소'),
              SizedBox(height: 8),
              if (event.sessions.length > 1) ...[
                Text('한 가지를 선택해야 계속할 수 있어요.', style: TextStyle(color: muted)),
                SizedBox(height: 13),
                for (var i = 0; i < event.sessions.length; i++)
                  _sessionChoice(i, event.sessions[i]),
              ] else if (event.sessions.isEmpty) ...[
                Text(
                  '시간 또는 장소가 불명확해요. 직접 입력해 주세요.',
                  style: TextStyle(color: muted),
                ),
                SizedBox(height: 12),
              ],
              TextField(
                controller: venueController,
                decoration: InputDecoration(
                  labelText: '장소',
                  prefixIcon: Icon(Icons.place_outlined),
                ),
              ),
              SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _chooseDateTime,
                icon: Icon(Icons.schedule),
                label: Text(startsAt == null ? '날짜와 시간 선택' : _date(startsAt!)),
                style: OutlinedButton.styleFrom(
                  minimumSize: Size.fromHeight(52),
                  foregroundColor: accent,
                ),
              ),
              if (startsAt != null) ...[
                SizedBox(height: 7),
                Text(
                  '종료: ${_date(endsAt!)} · 필요하면 캘린더에서 수정할 수 있어요.',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
              ],
            ],
          ),
        ),
        SizedBox(height: 14),
        if (event.applicationDeadline == null || event.participationFee == null) ...[
          _card(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _eyebrow('확인하지 못한 정보'),
            if (event.applicationDeadline == null) Text('• 신청 마감일'),
            if (event.participationFee == null) Text('• 참가비'),
            SizedBox(height: 10),
            Text('안내문에 없거나 확실하지 않아 비워 두었어요.', style: TextStyle(color: muted)),
            Wrap(spacing: 8, children: [
              TextButton(onPressed: () => setState(() => showUnknownInputs = true), child: Text('직접 입력')),
              TextButton(onPressed: () => setState(() { showUnknownInputs = false; deadlineController.clear(); feeController.clear(); }), child: Text('이 정보 없이 계속')),
            ]),
            if (showUnknownInputs) ...[
              TextField(controller: deadlineController, decoration: InputDecoration(labelText: '신청 마감일 (YYYY-MM-DD)'), keyboardType: TextInputType.datetime),
              SizedBox(height: 8),
              TextField(controller: feeController, decoration: InputDecoration(labelText: '참가비 (예: 무료, 10,000원)')),
            ],
          ])),
          SizedBox(height: 14),
        ],
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _eyebrow('03  알림'),
              SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final option in [15, 60, 1440, -1])
                    ChoiceChip(
                      label: Text(_reminderLabel(option)),
                      selected: reminderMinutes == option,
                      onSelected: (_) =>
                          setState(() => reminderMinutes = option),
                    ),
                ],
              ),
            ],
          ),
        ),
        SizedBox(height: 18),
        _button(
          saving ? '캘린더에 저장하는 중...' : '확인하고 캘린더에 저장',
          Icons.event_available_outlined,
          saving ? null : _save,
        ),
        SizedBox(height: 10),
        Center(
          child: TextButton(onPressed: _reset, child: Text('다시 스캔하기')),
        ),
      ],
    );
  }

  Widget _sessionChoice(int index, CueSession session) => Padding(
    padding: EdgeInsets.only(bottom: 9),
    child: InkWell(
      onTap: () => setState(() {
        selectedSession = index;
        _applySession(index);
      }),
      borderRadius: BorderRadius.circular(15),
      child: Container(
        padding: EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selectedSession == index ? mint : paper,
          border: Border.all(
            color: selectedSession == index ? accent : borderColor,
            width: selectedSession == index ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Row(
          children: [
            Icon(
              selectedSession == index
                  ? Icons.radio_button_checked
                  : Icons.radio_button_off,
              color: accent,
            ),
            SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.label.isEmpty
                        ? _date(session.startsAt)
                        : session.label,
                    style: TextStyle(fontWeight: FontWeight.w800, color: ink),
                  ),
                  Text(
                    '${_date(session.startsAt)} · ${session.venue}',
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _savedCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.check_circle, color: accent, size: 46),
        SizedBox(height: 15),
        Text(
          '캘린더에 저장했어요!',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: ink,
          ),
        ),
        SizedBox(height: 6),
        Text('설정한 알림과 함께 행사일에 다시 만나요.', style: TextStyle(color: muted)),
        SizedBox(height: 20),
        _button('다른 행사 스캔하기', Icons.add_a_photo_outlined, _reset),
      ],
    ),
  );

  Widget _stepsCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _eyebrow('CUE와 함께하는 방법'),
        SizedBox(height: 15),
        _step(
          Icons.photo_camera_outlined,
          '01',
          '안내물을 보여주세요',
          '촬영하거나 사진·문서 선택',
        ),
        _step(
          Icons.auto_awesome_outlined,
          '02',
          'AI가 정리해요',
          '행사 여부, 시간과 장소를 확인',
        ),
        _step(
          Icons.event_available_outlined,
          '03',
          '확인하고 저장해요',
          '승인 후에만 캘린더에 추가',
        ),
      ],
    ),
  );

  Widget _step(IconData icon, String number, String title, String desc) =>
      Padding(
        padding: EdgeInsets.only(bottom: 15),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: mint,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: accent, size: 22),
            ),
            SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$number  $title',
                    style: TextStyle(fontWeight: FontWeight.w800, color: ink),
                  ),
                  Text(desc, style: TextStyle(color: muted, fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _saved() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _pageTitle('내 일정', '확인하고 저장한 행사'),
      SizedBox(height: 22),
      if (saved.isEmpty)
        _empty(Icons.event_note_outlined, '아직 저장한 행사가 없어요', '첫 포스터를 스캔해 보세요.'),
      for (final event in saved.reversed) ...[
        _eventTile(event),
        SizedBox(height: 11),
      ],
    ],
  );

  Widget _discover() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _pageTitle('취향 발견', '좋아할 만한 다음 행사'),
      SizedBox(height: 13),
      Container(
        padding: EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: mint,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          'Cue가 저장한 일정에서 관심사를 찾고, 공식 행사 안내를 확인해 다음 행사를 추천해요.',
          style: TextStyle(color: accent, height: 1.5),
        ),
      ),
      SizedBox(height: 18),
      if (recommendationLoading && recommended.isEmpty)
        _empty(Icons.auto_awesome, '공식 행사 찾는 중', '관심사와 일정이 맞는 행사를 확인하고 있어요.'),
      if (!recommendationLoading && recommended.isEmpty)
        _empty(
          Icons.explore_outlined,
          '아직 추천할 행사가 없어요',
          '공식 안내에서 확인된 행사가 없어요. 나중에 새로고침해 주세요.',
        ),
      for (final event in recommended) ...[
        _eventTile(event, recommended: true),
        SizedBox(height: 11),
      ],
    ],
  );

  Widget _settings() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _pageTitle('설정', '일정을 담는 방식을 정해요'),
      SizedBox(height: 20),
      if (userId != null) ...[
        _card(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _eyebrow('내 계정'),
              SizedBox(height: 10),
              Text(cloudConnected ? 'Supabase에 연결됨' : '이 기기에 저장 중'),
              SizedBox(height: 4),
              SelectableText('사용자 ID  $userId'),
            ],
          ),
        ),
        SizedBox(height: 14),
      ],
      _card(
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _eyebrow('화면 테마'),
            SizedBox(height: 14),
            SegmentedButton<ThemeMode>(
              segments: [
                ButtonSegment(value: ThemeMode.system, label: Text('시스템')),
                ButtonSegment(value: ThemeMode.light, label: Text('라이트')),
                ButtonSegment(value: ThemeMode.dark, label: Text('다크')),
              ],
              selected: {cueThemeMode.value},
              onSelectionChanged: (value) async {
                cueThemeMode.value = value.first;
                await (await SharedPreferences.getInstance()).setString(
                  'theme_mode',
                  value.first.name,
                );
              },
            ),
          ],
        ),
      ),
      SizedBox(height: 14),
      _card(
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _eyebrow('개인화와 추천'),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: Text('선택을 기억해 추천'),
              subtitle: Text('끄면 새로운 관심 행동을 기록하지 않아요.'),
              value: personalizationEnabled,
              onChanged: (value) =>
                  _updateProfile({'personalizationEnabled': value}),
            ),
            Divider(color: borderColor),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: Text('행사 추천 표시'),
              subtitle: Text('취향 발견 화면의 추천을 켜거나 꺼요.'),
              value: recommendationEnabled,
              onChanged: personalizationEnabled
                  ? (value) => _updateProfile({'recommendationEnabled': value})
                  : null,
            ),
          ],
        ),
      ),
      SizedBox(height: 14),
      _card(
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _eyebrow('캘린더와 알림'),
            SizedBox(height: 8),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.calendar_month_outlined, color: accent),
              title: Text('저장할 캘린더'),
              subtitle: Text(preferredCalendarName),
              trailing: Icon(Icons.chevron_right, color: muted),
              onTap: _chooseCalendar,
            ),
            Divider(color: borderColor),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.notifications_outlined, color: accent),
              title: Text('기본 알림'),
              subtitle: Text('새 행사에 먼저 적용돼요'),
              trailing: DropdownButton<int>(
                value: defaultReminderMinutes,
                underline: SizedBox.shrink(),
                items: [15, 60, 1440, -1]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(_reminderLabel(value)),
                      ),
                    )
                    .toList(),
                onChanged: (value) async {
                  if (value == null) return;
                  setState(() {
                    defaultReminderMinutes = value;
                    reminderMinutes = value;
                  });
                  await (await SharedPreferences.getInstance()).setInt(
                    'default_reminder_minutes',
                    value,
                  );
                },
              ),
            ),
            Divider(color: borderColor),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.timelapse_outlined, color: accent),
              title: Text('기본 일정 길이'),
              subtitle: Text('종료 시간이 없는 행사에 적용돼요'),
              trailing: DropdownButton<int>(
                value: defaultDurationMinutes,
                underline: SizedBox.shrink(),
                items: [60, 120, 180]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text('${value ~/ 60}시간'),
                      ),
                    )
                    .toList(),
                onChanged: (value) async {
                  if (value == null) return;
                  setState(() => defaultDurationMinutes = value);
                  await (await SharedPreferences.getInstance()).setInt(
                    'default_duration_minutes',
                    value,
                  );
                },
              ),
            ),
          ],
        ),
      ),
      SizedBox(height: 14),
      _card(
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '사진과 일정 데이터',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: ink,
              ),
            ),
            SizedBox(height: 8),
            Text(
              '사진과 문서는 분석할 때 서버를 거쳐 OpenAI로 전송합니다. 한글 문서는 서버에서 글자를 추출해 전달합니다. 행사 안내물이 아니면 추가 추출을 중단합니다.',
              style: TextStyle(color: muted, height: 1.5),
            ),
          ],
        ),
      ),
      SizedBox(height: 12),
      Center(
        child: TextButton.icon(
          onPressed: _refresh,
          icon: Icon(Icons.refresh),
          label: Text('일정 및 추천 새로고침'),
        ),
      ),
    ],
  );

  Widget _eventTile(Map<String, dynamic> event, {bool recommended = false}) {
    DateTime? date;
    try {
      date = DateTime.parse(event['startsAt'] as String).toLocal();
    } catch (_) {}
    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _tag(event['category'] as String? ?? '기타'),
              if (recommended && (event['score'] as num? ?? 0) > 0) ...[
                SizedBox(width: 8),
                Text(
                  '취향이 맞아요',
                  style: TextStyle(
                    color: accent,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
          SizedBox(height: 11),
          Text(
            event['title'] as String? ?? '',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: ink,
            ),
          ),
          SizedBox(height: 10),
          if (date != null) _detail(Icons.schedule, _date(date)),
          _detail(Icons.place_outlined, event['venue'] as String? ?? ''),
          if (recommended && event['reason'] is String) ...[
            SizedBox(height: 8),
            Text(
              event['reason'] as String,
              style: TextStyle(color: muted, fontSize: 13),
            ),
          ],
          if (recommended && event['sourceUrl'] is String) ...[
            SizedBox(height: 8),
            TextButton.icon(
              onPressed: () async {
                final url = Uri.tryParse(event['sourceUrl'] as String);
                if (url == null || !await launchUrl(url, mode: LaunchMode.externalApplication)) {
                  _message('공식 안내 페이지를 열 수 없습니다.');
                }
              },
              icon: Icon(Icons.open_in_new, size: 18),
              label: Text('공식 안내 확인'),
            ),
          ],
          if (!recommended) ...[
            SizedBox(height: 14),
            if (busyEventId == event['id'])
              Center(
                child: Padding(
                  padding: EdgeInsets.all(8),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      SizedBox(width: 9),
                      Text('캘린더와 알림을 확인하는 중'),
                    ],
                  ),
                ),
              )
            else
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _editSaved(event),
                    icon: Icon(Icons.edit_outlined),
                    label: Text('수정'),
                  ),
                  SizedBox(width: 8),
                  TextButton.icon(
                    onPressed: () => _cancelSaved(event),
                    icon: Icon(Icons.event_busy_outlined),
                    label: Text('일정 취소'),
                  ),
                ],
              ),
          ],
          if (recommended) ...[
            SizedBox(height: 14),
            Wrap(
              spacing: 6,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _feedback(event, 'interested'),
                  icon: Icon(Icons.favorite_border),
                  label: Text('관심 있음'),
                ),
                TextButton.icon(
                  onPressed: () => _dismissRecommendation(event),
                  icon: Icon(Icons.not_interested_outlined),
                  label: Text('관심 없음'),
                ),
              ],
            ),
            _button(
              '계획하기',
              Icons.event_available_outlined,
              () => _planRecommendation(event),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _updateProfile(Map<String, dynamic> changes) async {
    try {
      await api.patch('/v1/profile', changes);
      await _refresh();
    } catch (error) {
      _message(error.toString());
    }
  }

  Future<void> _feedback(Map<String, dynamic> event, String action) async {
    try {
      await api.post('/v1/interactions', {
        'eventId': event['id'],
        'action': action,
      });
      await _refresh();
      _message(action == 'interested' ? '관심 있는 행사로 기억했어요.' : '이런 추천은 줄일게요.');
    } catch (error) {
      _message(error.toString());
    }
  }

  Future<void> _dismissRecommendation(Map<String, dynamic> event) async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(title: Text('관심 없는 이유 (선택사항)')),
        for (final choice in ['관심 없는 분야', '시간 안 맞음', '장소가 멂', '참가 조건 안 맞음', '이미 알고 있는 행사'])
          ListTile(title: Text(choice), onTap: () => Navigator.pop(context, choice)),
        TextButton(onPressed: () => Navigator.pop(context, ''), child: Text('이유 없이 관심 없음')),
      ])),
    );
    if (reason == null) return;
    try {
      await api.post('/v1/interactions', {
        'eventId': event['id'], 'action': 'not_interested',
        if (reason.isNotEmpty) 'reason': reason,
      });
      await _refresh();
      _message('추천에서 제외했어요.');
    } catch (error) { _message(error.toString()); }
  }

  Future<void> _planRecommendation(Map<String, dynamic> event) async {
    try {
      await api.post('/v1/interactions', {
        'eventId': event['id'],
        'action': 'recommendation_opened',
      });
      await api.post('/v1/goals', {'eventId': event['id']});
      _openRecommendation(event);
    } catch (error) {
      _message(error.toString());
    }
  }

  void _openRecommendation(Map<String, dynamic> event) {
    final session = CueSession(
      label: '',
      startsAt: DateTime.parse(event['startsAt'] as String).toLocal(),
      endsAt: DateTime.parse(event['endsAt'] as String).toLocal(),
      venue: event['venue'] as String,
    );
    setState(() {
      candidate = CueEvent(
        title: event['title'] as String,
        category: event['category'] as String,
        description: event['description'] as String? ?? '',
        tags: (event['tags'] as List<dynamic>? ?? [])
            .whereType<String>()
            .toList(),
        format: event['format'] as String? ?? '기타',
        domains: (event['domains'] as List<dynamic>? ?? []).whereType<String>().toList(),
        applicationDeadline: event['applicationDeadline'] as String?,
        participationFee: event['participationFee'] as String?,
        sessions: [session],
      );
      titleController.text = candidate!.title;
      selectedCategory = candidate!.category;
      selectedSession = 0;
      _applySession(0);
      stage = ScanStage.review;
      tab = 0;
    });
  }

  Widget _detail(IconData icon, String text) => Padding(
    padding: EdgeInsets.only(top: 5),
    child: Row(
      children: [
        Icon(icon, size: 16, color: muted),
        SizedBox(width: 7),
        Expanded(
          child: Text(text, style: TextStyle(color: muted, fontSize: 13)),
        ),
      ],
    ),
  );
  Widget _pageTitle(String title, String subtitle) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: ink),
      ),
      SizedBox(height: 5),
      Text(subtitle, style: TextStyle(color: muted)),
    ],
  );
  Widget _empty(IconData icon, String title, String text) => _card(
    Center(
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Column(
          children: [
            Icon(icon, size: 44, color: accent),
            SizedBox(height: 16),
            Text(
              title,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: ink,
              ),
            ),
            SizedBox(height: 6),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(color: muted),
            ),
          ],
        ),
      ),
    ),
  );
  Widget _notice(String text, {VoidCallback? onTap}) => Container(
    padding: EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: isDark ? Color(0xFF1A3A52) : Color(0xFFE5F4FF),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Icon(Icons.info_outline, size: 20, color: accent),
        SizedBox(width: 7),
        Expanded(
          child: Text(text, style: TextStyle(fontSize: 12, color: ink)),
        ),
        if (onTap != null)
          IconButton(
            onPressed: onTap,
            icon: Icon(Icons.refresh),
            tooltip: '다시 연결',
          ),
      ],
    ),
  );
  Widget _card(Widget child) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: surface,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: borderColor),
    ),
    child: child,
  );
  Widget _eyebrow(String value) => Text(
    value,
    style: TextStyle(
      fontSize: 12,
      letterSpacing: 1.1,
      color: accent,
      fontWeight: FontWeight.w900,
    ),
  );
  Widget _tag(String value) => Container(
    padding: EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: mint,
      borderRadius: BorderRadius.circular(50),
    ),
    child: Text(
      value,
      style: TextStyle(
        color: accent,
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
  String _reminderLabel(int value) => switch (value) {
    15 => '15분 전',
    60 => '1시간 전',
    1440 => '1일 전',
    _ => '알림 없음',
  };
  Widget _button(
    String label,
    IconData icon,
    VoidCallback? onTap, {
    bool light = false,
    bool outlined = false,
  }) => SizedBox(
    width: double.infinity,
    height: 54,
    child: outlined
        ? OutlinedButton.icon(
            onPressed: onTap,
            icon: Icon(icon),
            label: Text(label),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.white,
              side: BorderSide(color: Color(0xFFD8EEFC)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(15),
              ),
            ),
          )
        : FilledButton.icon(
            onPressed: onTap,
            icon: Icon(icon),
            label: Text(label),
            style: FilledButton.styleFrom(
              backgroundColor: light ? Color(0xFFE0F3FF) : accent,
              foregroundColor: light
                  ? Color(0xFF17344E)
                  : (isDark ? Color(0xFF0B1928) : Colors.white),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(15),
              ),
              textStyle: TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
  );
  String _date(DateTime value) =>
      '${value.year}.${value.month.toString().padLeft(2, '0')}.${value.day.toString().padLeft(2, '0')}  ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}
