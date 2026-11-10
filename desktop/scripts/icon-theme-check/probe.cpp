#include <KIconEngine>
#include <KIconLoader>
#include <KIconTheme>
#include <QGuiApplication>
#include <QIcon>
#include <QImage>
#include <QTimer>
#include <algorithm>
#include <cstdio>

struct Tile {
    int luma;
    int alpha;
};

static Tile tile(const QImage &image)
{
    const int n = image.width();
    const QPoint points[] = {{n * 16 / 100, n / 2}, {n * 84 / 100, n / 2}, {n / 2, n * 16 / 100}, {n / 2, n * 84 / 100}};
    int sum = 0;
    int alpha = 255;
    for (const QPoint &p : points) {
        const QColor c = image.pixelColor(p);
        sum += (c.red() * 299 + c.green() * 587 + c.blue() * 114) / 1000;
        alpha = std::min(alpha, c.alpha());
    }
    return {sum / 4, alpha};
}

int main(int argc, char **argv)
{
    QGuiApplication app(argc, argv);
    if (argc < 4) {
        std::fprintf(stderr, "usage: probe ICON-NAME OUT-DIR CHANGES\n");
        return 2;
    }
    const QString name = QString::fromLocal8Bit(argv[1]);
    const QString out = QString::fromLocal8Bit(argv[2]);
    const int changes = std::atoi(argv[3]);
    const QIcon icon(new KIconEngine(name, KIconLoader::global()));
    int seen = 0;
    const auto report = [&]() {
        const QString theme = KIconLoader::global()->theme() ? KIconLoader::global()->theme()->internalName() : QStringLiteral("none");
        const QString path = KIconLoader::global()->iconPath(name, -48, true);
        for (int size : {16, 22, 32, 48, 128}) {
            const QImage image = icon.pixmap(size, size).toImage();
            image.save(out + QStringLiteral("/%1-%2-%3.png").arg(seen).arg(theme).arg(size));
            const Tile t = tile(image);
            std::printf("%d %s %d %d %d %s\n", seen, qPrintable(theme), size, t.luma, t.alpha, qPrintable(path));
        }
        std::fflush(stdout);
        if (seen == changes) {
            app.quit();
        }
        seen++;
    };
    QObject::connect(KIconLoader::global(), &KIconLoader::iconChanged, &app, [&](int) {
        report();
    });
    QTimer::singleShot(0, &app, report);
    return app.exec();
}
