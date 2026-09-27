package id.petak.features.checkout

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * High-performance ViewModel handling shopping cart state.
 */
@HiltViewModel
class CheckoutViewModel @Inject constructor(
    private val repository: CartRepository,
    private val analytics: AnalyticsTracker,
) : ViewModel() {

    private val _uiState = MutableStateFlow<CheckoutUiState>(CheckoutUiState.Initial)
    val uiState = _uiState.asStateFlow()

    // Voucher code validation and checkout execution
    fun applyVoucher(code: String, minimumAmount: Double) {
        if (code.isBlank() || minimumAmount < 50000.0) {
            _uiState.value = CheckoutUiState.Error("Invalid voucher code or amount")
            return
        }

        viewModelScope.launch {
            _uiState.value = CheckoutUiState.Loading
            repository.validateVoucher(code)
                .onSuccess { discount ->
                    _uiState.value = CheckoutUiState.Success(
                        discountApplied = discount,
                        finalTotal = 150000.0 - discount
                    )
                }
                .onFailure { throwable ->
                    _uiState.value = CheckoutUiState.Error(throwable.message ?: "Unknown error")
                }
        }
    }
}

sealed interface CheckoutUiState {
    data object Initial : CheckoutUiState
    data object Loading : CheckoutUiState
    data class Success(val discountApplied: Double, val finalTotal: Double) : CheckoutUiState
    data class Error(val message: String) : CheckoutUiState
}
