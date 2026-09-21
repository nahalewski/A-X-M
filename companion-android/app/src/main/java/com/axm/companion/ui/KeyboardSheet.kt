package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.axm.companion.protocol.KeyboardPrompt

/**
 * When A-X-M opens a text prompt, this sheet takes the phone's screen: the same
 * title and field, with the phone's own keyboard. Every keystroke goes to the
 * menu so the field fills in on the TV as you type; Done (or the keyboard's
 * enter) submits it, and the menu moves to its next field or closes.
 */
@Composable
fun KeyboardSheet(prompt: KeyboardPrompt, onInput: (String, Boolean) -> Unit, onDismiss: () -> Unit) {
    var text by remember(prompt.title, prompt.label) { mutableStateOf(prompt.value) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(prompt.title, prompt.label) { focus.requestFocus() }

    Box(Modifier.fillMaxSize().background(Color(0xCC000000)).imePadding(), contentAlignment = Alignment.BottomCenter) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp).clip(RoundedCornerShape(22.dp)).background(Axm.Panel).padding(20.dp),
        ) {
            Text("A-X-M IS ASKING", style = MaterialTheme.typography.labelLarge, color = Axm.Accent)
            Text(prompt.title, style = MaterialTheme.typography.titleLarge, color = Axm.Text)
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; onInput(it, false) },
                label = { Text(prompt.label) },
                singleLine = true,
                visualTransformation = if (prompt.secret) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (prompt.secret) KeyboardType.Password else KeyboardType.Text,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { onInput(text, true) }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Axm.Text, unfocusedTextColor = Axm.Text,
                    focusedBorderColor = Axm.Accent, unfocusedBorderColor = Axm.AccentDim,
                    focusedLabelColor = Axm.Accent, unfocusedLabelColor = Axm.TextDim, cursorColor = Axm.Accent,
                ),
            )
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Use the TV instead", color = Axm.TextDim) }
                Button(
                    onClick = { onInput(text, true) },
                    colors = ButtonDefaults.buttonColors(containerColor = Axm.Accent, contentColor = Axm.Background),
                ) { Text("Done") }
            }
        }
    }
}
