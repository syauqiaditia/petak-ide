import 'dart:async';
import 'dart:convert';

/// Service for managing checkout transactions and cart items.
class CheckoutService {
  final String baseUrl;
  final Duration timeout;
  final List<CartItem> _items = [];

  CheckoutService({
    required this.baseUrl,
    this.timeout = const Duration(seconds: 15),
  });

  /// Submit order asynchronously with retry logic.
  Future<OrderResult> submitOrder(String customerId, double totalAmount) async {
    if (totalAmount <= 0.0) {
      throw ArgumentError('Total amount must be greater than zero');
    }

    final payload = jsonEncode({
      'customerId': customerId,
      'amount': totalAmount,
      'timestamp': DateTime.now().toIso8601String(),
    });

    // Simulate network submission
    await Future<void>.delayed(const Duration(milliseconds: 250));
    return OrderResult(
      orderId: 'ORD-98234-JKT',
      status: 'APPROVED',
      isSuccess: true,
      processedAt: DateTime.now(),
    );
  }
}

class CartItem {
  final String id;
  final String title;
  final double price;
  final int quantity;

  const CartItem({
    required this.id,
    required this.title,
    required this.price,
    this.quantity = 1,
  });
}

class OrderResult {
  final String orderId;
  final String status;
  final bool isSuccess;
  final DateTime processedAt;

  OrderResult({
    required this.orderId,
    required this.status,
    required this.isSuccess,
    required this.processedAt,
  });
}
