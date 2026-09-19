import 'package:device_calendar/device_calendar.dart' as calendar;
import 'package:flutter/material.dart';

import 'cue_categories.dart';

class SavedEventDraft {
  const SavedEventDraft({
    required this.title,
    required this.venue,
    required this.category,
    required this.startsAt,
    required this.endsAt,
    required this.reminderMinutes,
  });
  final String title;
  final String venue;
  final String category;
  final DateTime startsAt;
  final DateTime endsAt;
  final int reminderMinutes;
}

class SavedEventEditor extends StatefulWidget {
  const SavedEventEditor({
    super.key,
    required this.saved,
    required this.calendarEvent,
  });
  final Map<String, dynamic> saved;
  final calendar.Event calendarEvent;
  @override
  State<SavedEventEditor> createState() => _SavedEventEditorState();
}

class _SavedEventEditorState extends State<SavedEventEditor> {
  static const categories = cueCategories;
  late final TextEditingController title;
  late final TextEditingController venue;
  late String category;
  late DateTime start;
  late DateTime end;
  late int reminder;

  @override
  void initState() {
    super.initState();
    title = TextEditingController(
      text:
          widget.calendarEvent.title ?? widget.saved['title'] as String? ?? '',
    );
    venue = TextEditingController(
      text:
          widget.calendarEvent.location ??
          widget.saved['venue'] as String? ??
          '',
    );
    category = categories.contains(widget.saved['category'])
        ? widget.saved['category'] as String
        : '기타';
    start =
        (widget.calendarEvent.start ??
                DateTime.parse(widget.saved['startsAt'] as String))
            .toLocal();
    end =
        (widget.calendarEvent.end ??
                DateTime.parse(widget.saved['endsAt'] as String))
            .toLocal();
    final stored = widget.saved['reminderMinutes'];
    final current = stored is int
        ? stored
        : (widget.calendarEvent.reminders?.firstOrNull?.minutes ?? -1);
    reminder = [-1, 15, 60, 1440].contains(current) ? current : -1;
  }

  @override
  void dispose() {
    title.dispose();
    venue.dispose();
    super.dispose();
  }

  Future<void> _pickTime(bool beginning) async {
    final current = beginning ? start : end;
    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (!mounted || time == null) return;
    setState(() {
      final chosen = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
      if (beginning) {
        final duration = end.difference(start);
        start = chosen;
        end = chosen.add(
          duration.isNegative || duration == Duration.zero
              ? Duration(hours: 2)
              : duration,
        );
      } else {
        end = chosen;
      }
    });
  }

  String _date(DateTime value) =>
      '${value.year}.${value.month.toString().padLeft(2, '0')}.${value.day.toString().padLeft(2, '0')}  ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  String _reminder(int value) => switch (value) {
    15 => '15분 전',
    60 => '1시간 전',
    1440 => '1일 전',
    _ => '알림 없음',
  };

  void _submit() {
    if (title.text.trim().isEmpty || venue.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('행사 이름과 장소를 입력해 주세요.')));
      return;
    }
    if (!end.isAfter(start) || end.difference(start) > Duration(days: 7)) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('종료 시간은 시작 이후 7일 이내여야 합니다.')));
      return;
    }
    Navigator.pop(
      context,
      SavedEventDraft(
        title: title.text.trim(),
        venue: venue.text.trim(),
        category: category,
        startsAt: start,
        endsAt: end,
        reminderMinutes: reminder,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('저장한 일정 수정')),
    body: SafeArea(
      child: ListView(
        padding: EdgeInsets.all(20),
        children: [
          Text(
            '캘린더 일정과 알림을 함께 수정해요.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          SizedBox(height: 20),
          TextField(
            controller: title,
            maxLength: 120,
            decoration: InputDecoration(labelText: '행사 이름'),
          ),
          SizedBox(height: 10),
          TextField(
            controller: venue,
            maxLength: 160,
            decoration: InputDecoration(labelText: '장소'),
          ),
          SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: category,
            decoration: InputDecoration(labelText: '행사 종류'),
            items: categories
                .map((item) => DropdownMenuItem(value: item, child: Text(item)))
                .toList(),
            onChanged: (value) {
              if (value != null) setState(() => category = value);
            },
          ),
          SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: () => _pickTime(true),
            icon: Icon(Icons.schedule),
            label: Text('시작  ${_date(start)}'),
          ),
          OutlinedButton.icon(
            onPressed: () => _pickTime(false),
            icon: Icon(Icons.schedule_outlined),
            label: Text('종료  ${_date(end)}'),
          ),
          SizedBox(height: 18),
          Text('알림', style: Theme.of(context).textTheme.titleMedium),
          Wrap(
            spacing: 8,
            children: [
              for (final option in [15, 60, 1440, -1])
                ChoiceChip(
                  label: Text(_reminder(option)),
                  selected: reminder == option,
                  onSelected: (_) => setState(() => reminder = option),
                ),
            ],
          ),
          SizedBox(height: 26),
          FilledButton.icon(
            onPressed: _submit,
            icon: Icon(Icons.check),
            label: Text('변경 내용 저장'),
          ),
        ],
      ),
    ),
  );
}
