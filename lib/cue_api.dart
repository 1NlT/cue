import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const supabasePublishableKey = String.fromEnvironment(
  'SUPABASE_PUBLISHABLE_KEY',
);
final useSupabaseAuth =
    supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

class CueSession {
  const CueSession({
    required this.label,
    required this.startsAt,
    required this.endsAt,
    required this.venue,
  });
  final String label;
  final DateTime startsAt;
  final DateTime endsAt;
  final String venue;

  factory CueSession.fromJson(Map<String, dynamic> json) => CueSession(
    label: json['label'] as String? ?? '',
    startsAt: DateTime.parse(json['startsAt'] as String).toLocal(),
    endsAt: DateTime.parse(json['endsAt'] as String).toLocal(),
    venue: json['venue'] as String? ?? '',
  );
}

class CueEvent {
  const CueEvent({
    required this.title,
    required this.category,
    required this.description,
    required this.sessions,
    this.tags = const [],
    this.format = '기타',
    this.domains = const [],
    this.applicationDeadline,
    this.participationFee,
  });
  final String title;
  final String category;
  final String description;
  final List<CueSession> sessions;
  final List<String> tags;
  final String format;
  final List<String> domains;
  final String? applicationDeadline;
  final String? participationFee;

  factory CueEvent.fromJson(Map<String, dynamic> json) => CueEvent(
    title: json['title'] as String? ?? '',
    category: json['category'] as String? ?? '기타',
    description: json['description'] as String? ?? '',
    tags: (json['tags'] as List<dynamic>? ?? []).whereType<String>().toList(),
    format: json['format'] as String? ?? '기타',
    domains: (json['domains'] as List<dynamic>? ?? []).whereType<String>().toList(),
    applicationDeadline: json['applicationDeadline'] as String?,
    participationFee: json['participationFee'] as String?,
    sessions: (json['sessions'] as List<dynamic>? ?? [])
        .map((e) => CueSession.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

class CueApi {
  CueApi(this.baseUrl);
  final String baseUrl;
  String? _token;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    if (useSupabaseAuth) {
      final auth = Supabase.instance.client.auth;
      if (auth.currentSession == null) await auth.signInAnonymously();
      _token = auth.currentSession?.accessToken;
      if (_token == null) throw const CueApiException('익명 사용자 연결에 실패했습니다.');
      final legacyToken = prefs.getString('cue_session_token');
      if (legacyToken != null) {
        try {
          await _request('POST', '/v1/account/claim', {
            'legacyToken': legacyToken,
          });
        } on CueApiException catch (error) {
          if (error.status != 404) rethrow;
        }
        await prefs.remove('cue_session_token');
      }
      await get('/v1/me');
      return;
    }
    _token = prefs.getString('cue_session_token');
    if (_token != null) {
      try {
        await get('/v1/me');
        return;
      } on CueApiException catch (error) {
        if (error.status != 401) rethrow;
      }
    }
    final response = await _request('POST', '/v1/session', {});
    _token = response['token'] as String;
    await prefs.setString('cue_session_token', _token!);
  }

  Future<Map<String, dynamic>> get(String route) => _request('GET', route);
  Future<Map<String, dynamic>> post(String route, Map<String, dynamic> body) =>
      _request('POST', route, body);
  Future<Map<String, dynamic>> patch(String route, Map<String, dynamic> body) =>
      _request('PATCH', route, body);
  Future<Map<String, dynamic>> delete(String route) =>
      _request('DELETE', route);

  Future<Map<String, dynamic>> _request(
    String method,
    String route, [
    Map<String, dynamic>? body,
  ]) async {
    final uri = Uri.parse('$baseUrl$route');
    try {
      final response =
          await (method == 'GET'
                  ? http.get(uri, headers: _headers())
                  : method == 'DELETE'
                  ? http.delete(uri, headers: _headers())
                  : method == 'PATCH'
                  ? http.patch(uri, headers: _headers(), body: jsonEncode(body))
                  : http.post(uri, headers: _headers(), body: jsonEncode(body)))
              .timeout(const Duration(seconds: 100));
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is! Map<String, dynamic>) {
        throw const CueApiException('서버 응답 형식이 올바르지 않습니다.');
      }
      if (response.statusCode >= 400) {
        throw CueApiException(
          decoded['error'] as String? ?? '요청에 실패했습니다.',
          status: response.statusCode,
        );
      }
      return decoded;
    } on TimeoutException {
      throw const CueApiException('서버 응답 시간이 초과됐습니다. 다시 시도해 주세요.');
    } on SocketException {
      throw const CueApiException('서버에 연결할 수 없습니다. 네트워크와 서버 주소를 확인해 주세요.');
    } on FormatException {
      throw const CueApiException('서버 응답을 읽을 수 없습니다.');
    }
  }

  Map<String, String> _headers() => {
    'content-type': 'application/json',
    if (useSupabaseAuth &&
        Supabase.instance.client.auth.currentSession?.accessToken != null)
      'authorization':
          'Bearer ${Supabase.instance.client.auth.currentSession!.accessToken}'
    else if (_token != null)
      'authorization': 'Bearer $_token',
  };
}

class CueApiException implements Exception {
  const CueApiException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}
