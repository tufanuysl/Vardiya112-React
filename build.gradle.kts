plugins {
    base
}

tasks.register<Exec>("npmInstall") {
    inputs.file("package.json")
    outputs.dir("node_modules")
    commandLine("npm", "install")
}

tasks.register<Exec>("npmBuild") {
    dependsOn("npmInstall")
    inputs.dir("src")
    inputs.file("package.json")
    outputs.dir("dist")
    commandLine("npm", "run", "build")
}

tasks.register<Exec>("lint") {
    dependsOn("npmInstall")
    commandLine("npm", "run", "lint")
}

tasks.register("assembleDebug") {
    dependsOn("npmBuild")
}

tasks.register("assembleRelease") {
    dependsOn("npmBuild")
}

tasks.named("build") {
    dependsOn("npmBuild")
}

tasks.named("check") {
    dependsOn("lint")
}

tasks.named("assemble") {
    dependsOn("npmBuild")
}
