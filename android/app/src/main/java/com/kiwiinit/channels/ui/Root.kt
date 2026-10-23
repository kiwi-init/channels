package com.kiwiinit.channels.ui

import android.net.Uri
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.kiwiinit.channels.engine.Engine
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Phase
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.Tone

private const val CHOOSE = "choose"

private fun chat(spot: Spot): String = "chat/${Uri.encode(spot.code)}/${Uri.encode(spot.place)}"

private fun details(spot: Spot): String = "details/${Uri.encode(spot.code)}/${Uri.encode(spot.place)}"

@Composable
fun Root(model: AppModel, unlock: () -> Unit) {
    val view = LocalView.current
    LaunchedEffect(model) { model.buzz.collect { view.buzz(it) } }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        model.engine?.let { EngineHost(it) }
        when (val phase = model.phase) {
            Phase.Starting -> Unit
            Phase.Unlinked -> LinkScreen(model)
            Phase.Ready -> Ready(model)
            is Phase.Broken -> Centered("Channels can't start", phase.why)
        }
        if (model.lock.locked && model.phase == Phase.Ready) Locked(unlock)
    }
}

@Composable
private fun EngineHost(engine: Engine) {
    val context = LocalContext.current
    AndroidView(factory = { engine.attach(context) }, modifier = Modifier.size(1.dp).clearAndSetSemantics {})
    DisposableEffect(engine) { onDispose { engine.detach() } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Ready(model: AppModel) {
    val nav = rememberNavController()
    val slide = tween<androidx.compose.ui.unit.IntOffset>(320)
    NavHost(
        navController = nav,
        startDestination = "list",
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface),
        enterTransition = { slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, slide) + fadeIn(tween(220)) },
        exitTransition = { slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Start, slide) { it / 4 } + fadeOut(tween(220)) },
        popEnterTransition = { slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.End, slide) { it / 4 } + fadeIn(tween(220)) },
        popExitTransition = { slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, slide) + fadeOut(tween(220)) },
    ) {
        composable("list") {
            ConversationList(model, open = { nav.navigate(chat(it)) }, settings = { nav.navigate("settings") })
        }
        composable(
            "chat/{code}/{place}",
            arguments = listOf(navArgument("code") { type = NavType.StringType }, navArgument("place") { type = NavType.StringType }),
        ) { entry ->
            val code = entry.arguments?.getString("code") ?: ""
            val place = entry.arguments?.getString("place") ?: "main"
            val chosen by entry.savedStateHandle.getStateFlow<String?>(CHOOSE, null).collectAsStateWithLifecycle()
            ConversationScreen(
                model = model,
                start = Spot(code, place),
                chosen = chosen,
                consumeChosen = { entry.savedStateHandle[CHOOSE] = null },
                back = { nav.popBackStack() },
                details = { nav.navigate(details(it)) },
            )
        }
        composable(
            "details/{code}/{place}",
            arguments = listOf(navArgument("code") { type = NavType.StringType }, navArgument("place") { type = NavType.StringType }),
        ) { entry ->
            val code = entry.arguments?.getString("code") ?: ""
            val place = entry.arguments?.getString("place") ?: "main"
            DetailsScreen(
                model,
                code,
                place,
                back = { nav.popBackStack() },
                choose = { key ->
                    nav.previousBackStackEntry?.savedStateHandle?.set(CHOOSE, key)
                    nav.popBackStack()
                },
            )
        }
        composable("settings") {
            SettingsScreen(model) { nav.popBackStack() }
        }
    }
    if (model.relinking) {
        val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { model.cancelLink() }, sheetState = sheet) {
            LinkScreen(model)
        }
    }
}

@Composable
private fun Locked(unlock: () -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, tint = Tone.current.ink3, modifier = Modifier.size(32.dp))
        Text("Channels is locked", style = MaterialTheme.typography.titleLarge)
        FilledTonalButton(onClick = unlock, modifier = Modifier.padding(top = 4.dp)) { Text("Unlock") }
    }
}
