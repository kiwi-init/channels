import java.io.File
import javax.inject.Inject
import org.gradle.process.ExecOperations
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

val repoDir: File = rootDir.parentFile

val appVersion: String = Regex("""VERSION\s*=\s*"([^"]+)"""")
    .find(File(repoDir, "src/version.ts").readText())
    ?.groupValues?.get(1) ?: "0.0.0"

val bunPath: String = listOfNotNull(
    System.getenv("BUN"),
    System.getenv("PATH")?.split(File.pathSeparator)?.map { "$it/bun" }?.firstOrNull { File(it).canExecute() },
    "${System.getProperty("user.home")}/.bun/bin/bun",
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
).firstOrNull { File(it).canExecute() } ?: "bun"

abstract class BundleEngine : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:Input
    abstract val bun: Property<String>

    @get:Internal
    abstract val repo: DirectoryProperty

    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun bundle() {
        val out = output.get().file("engine.js").asFile
        exec.exec {
            workingDir = repo.get().asFile
            commandLine(bun.get(), "build", "ios/engine/main.ts", "--target", "browser", "--format", "iife", "--minify", "--outfile", out.absolutePath)
        }
    }
}

android {
    namespace = "com.kiwiinit.channels"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.kiwiinit.channels"
        minSdk = 29
        targetSdk = 36
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = appVersion
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.p12")
            storeType = "pkcs12"
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        create("release") {
            val secret = { name: String -> System.getenv(name)?.takeIf { it.isNotEmpty() } }
            val store = secret("KIWI_ANDROID_KEYSTORE")
            val storePassword = secret("KIWI_ANDROID_STORE_PASSWORD")
            val keyAlias = secret("KIWI_ANDROID_KEY_ALIAS")
            if (store != null || storePassword != null || keyAlias != null) {
                if (store == null || storePassword == null || keyAlias == null) {
                    throw GradleException("a release keystore takes KIWI_ANDROID_KEYSTORE, KIWI_ANDROID_STORE_PASSWORD and KIWI_ANDROID_KEY_ALIAS together")
                }
                val keystore = File(store)
                if (!keystore.isFile) throw GradleException("KIWI_ANDROID_KEYSTORE names no file: $store")
                storeFile = keystore
                storeType = if (keystore.extension.equals("jks", ignoreCase = true)) "jks" else "pkcs12"
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                keyPassword = secret("KIWI_ANDROID_KEY_PASSWORD") ?: storePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            ndk {
                abiFilters += "arm64-v8a"
            }
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

androidComponents {
    onVariants { variant ->
        val task = tasks.register<BundleEngine>("bundle${variant.name.replaceFirstChar { it.uppercase() }}Engine") {
            sources.from(
                fileTree(File(repoDir, "ios/engine")),
                fileTree(File(repoDir, "packages/core/src")),
                fileTree(File(repoDir, "packages/channel/src")),
                fileTree(File(repoDir, "desktop/src")),
                fileTree(File(repoDir, "packages/app/src")),
            )
            bun.set(bunPath)
            repo.set(repoDir)
        }
        variant.sources.assets?.addGeneratedSourceDirectory(task, BundleEngine::output)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.fragment.ktx)
    implementation(libs.lifecycle.compose)
    implementation(libs.navigation.compose)
    implementation(libs.biometric)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    implementation(libs.enriched.markdown)
    debugImplementation(libs.compose.tooling)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
}
